import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd();
const require = createRequire(root + '/packages/server/package.json');
const express = require('express'), pino = require('pino');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createMcpGatewayHandler, McpGatewayRequests } = await import(root + '/packages/server/src/server/mcp-gateway/mcp-gateway.ts'); const { JsonRpcIdScanner } = await import(root + '/packages/server/src/server/mcp-gateway/refusal-stream.ts'); const jsonRpcRequestId = (body) => {const s=new JsonRpcIdScanner();s.push(Buffer.from(body));return s.ids[0] ?? null;};
const REFUSAL = 'This session refuses the reported model';
const identity = { agentId: 'subject', sessionId: 'session', workspaceId: null };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const ready = (p, label) => Promise.race([p, delay(4000).then(() => { throw Error('timeout ' + label); })]);
async function listen(server) { await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
const selected = process.argv.slice(2).find(x => !x.startsWith('--'));
for (const mode of ['normal', 'partial-leading-id', 'partial-after-object', 'large-sdk-request', 'batch', 'partial-sse-event', 'result-without-terminator'].filter(x => !selected || selected === x)) {
  let refused = false, toolId, requestKeys, requestBytes = 0, streamController, receivedPrefix = '', settled = false, wire = '';
  const responseReady = deferred(), backendReady = deferred();
  const errors = [];
  const requests = new McpGatewayRequests();
  const backend = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let body = '';
    req.on('error', () => {});
    req.on('data', chunk => {
      body += chunk;
      if (mode.startsWith('partial-') && mode !== 'partial-sse-event' && toolId !== undefined && !res.headersSent) {
        receivedPrefix = body;
        res.writeHead(200, {'content-type':'text/event-stream'}); res.write(': ready\n\n'); backendReady.resolve();
      }
    });
    req.on('end', () => {
      const parsed = JSON.parse(body), message = Array.isArray(parsed) ? parsed[0] : parsed;
      if (message.method === 'initialize') {
        res.writeHead(200, {'content-type':'application/json'});
        res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}}));
      } else if (message.method === 'notifications/initialized' || message.id === undefined) res.writeHead(202).end();
      else if (message.method === 'tools/call' && !res.headersSent) {
        requestKeys = Object.keys(message); requestBytes = Buffer.byteLength(body);
        res.writeHead(200, {'content-type':'text/event-stream'});
        if (mode === 'partial-sse-event') res.write('event: message\ndata: {"jsonrpc":"2.0","id":' + message.id + ',"result":');
        else if (mode === 'result-without-terminator') res.write('event: message\ndata: ' + JSON.stringify({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'completed'}]}}));
        else res.write(': ready\n\n');
        backendReady.resolve();
      }
    });
  });
  const backendUrl = await listen(backend);
  const app = express();
  app.use('/mcp/backends', createMcpGatewayHandler({
    getBackends: () => new Map([['fixture',{url:backendUrl}]]),
    resolveAgent: token => token === 'fake-subject' ? identity : null,
    agentRefusal: () => refused ? REFUSAL : null, requests,
    sessionIdentity: {member:'claude/claude-opus-5-5',role:'validator'},
    resolveUpstream: async x => x, serverId:'sdk-fixture', logger:pino({level:'silent'})
  }));
  const gateway = http.createServer(app), gatewayUrl = await listen(gateway);
  const client = new Client({name:'validator',version:'1'});
  client.onerror = e => errors.push({name:e.name, message:e.message.slice(0,300),code:e.code});
  const wrappedFetch = async (url, init) => {
    let message;
    try { message = JSON.parse(init?.body); } catch {}
    const isTool = message?.method === 'tools/call';
    if (isTool) {
      toolId = message.id;
      if (mode === 'batch') init = {...init,body:JSON.stringify([message,{jsonrpc:'2.0',id:999,method:'tools/call',params:message.params}])};
      if (mode === 'partial-leading-id' || mode === 'partial-after-object') {
        const prefix = mode === 'partial-leading-id'
          ? '{"jsonrpc":"2.0","id":' + toolId + ',"method":"tools/call","params":'
          : '{"params":' + JSON.stringify(message.params) + ',"id":' + toolId + ',"jsonrpc":"2.0","method":';
        init = {...init,body:new ReadableStream({start(controller){streamController=controller;controller.enqueue(new TextEncoder().encode(prefix));}}),duplex:'half'};
      }
    }
    const response = await fetch(url,init);
    if (isTool) { void response.clone().text().then(x => {wire = x;}); responseReady.resolve(); }
    return response;
  };
  const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl + '/mcp/backends/fixture'), {
    requestInit:{headers:{Authorization:'Bearer fake-subject'}}, fetch:wrappedFetch,
    reconnectionOptions:{maxRetries:0}
  });
  try {
    await client.connect(transport);
    const started = Date.now();
    const answer = client.callTool({name:'read',arguments:{text:mode === 'large-sdk-request' ? 'x'.repeat(256*1024) : 'small'}}, undefined, {timeout:1200}).then(result=>({outcome:'result',result}), e=>({outcome:'error',name:e.name,code:e.code,message:e.message})).then(result => {settled = true; return result;});
    await ready(backendReady.promise,'backend stream'); await ready(responseReady.promise,'SDK HTTP response');
    await delay(20);
    const settledBeforeRefusal = settled;
    refused = true; requests.refuse('subject',REFUSAL);
    const result = await ready(answer,'SDK request');
    await delay(20);
    console.log(JSON.stringify({mode,toolId,requestKeys,requestBytes,partialId:receivedPrefix ? jsonRpcRequestId(receivedPrefix) : undefined,settledBeforeRefusal,result,elapsedMs:Date.now()-started,wire,transportErrors:errors,retainedRequests:requests.byAgent.size}));
    if (process.argv.includes('--assert-refusal')) assert.equal(result.code,-32003,'refused pending SDK request must end with the refusal');
  } finally {
    try {streamController?.close();} catch {}
    await client.close(); await close(gateway); await close(backend);
  }
}
for (const body of ['{"id":12,"params":', '{"params":{},"id":12,"method":', '[{"jsonrpc":"2.0","id":12,"method":"x"},{"jsonrpc":"2.0","id":13,"method":"x"}]', '{"method":"x","jsonrpc":"2.0","id":"escaped\\"id","params":', '{"id":12', '{"params":{"id":99},"method":"x","id":12}']) {
  console.log(JSON.stringify({parserBody:body,id:jsonRpcRequestId(body)}));
}
