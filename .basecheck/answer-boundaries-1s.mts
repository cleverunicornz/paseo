import http from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const root=process.cwd(), require=createRequire(root+'/packages/server/package.json');
const express=require('express'),pino=require('pino');
const {createMcpGatewayHandler,McpGatewayRequests}=await import(root+'/packages/server/src/server/mcp-gateway/mcp-gateway.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function listen(s){await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port;}
async function close(s){s.closeAllConnections();await new Promise(r=>s.close(r));}
async function write(res,chunk){if(res.destroyed)return false;if(res.write(chunk))return true;return await new Promise(resolve=>{
 const drain=()=>{res.off('close',closed);resolve(true);},closed=()=>{res.off('drain',drain);resolve(false);};res.once('drain',drain);res.once('close',closed);
});}
async function fixture(handler,mode='session'){
 const tracked=new McpGatewayRequests();let refused=false;
 const backend=http.createServer((req,res)=>{req.on('error',()=>{});req.resume();req.on('end',()=>{void handler(req,res);});});
 const url=await listen(backend),app=express();
 app.use('/mcp/backends',createMcpGatewayHandler({getBackends:()=>new Map([['fixture',{url}]]),resolveAgent:()=>({agentId:'fixture',sessionId:'s',workspaceId:null,drain:mode==='drain'}),sessionIdentity:mode==='outside'?null:{member:'claude/claude-opus-5-5',role:'validator'},agentRefusal:()=>refused?'fixture refusal':null,requests:tracked,resolveUpstream:async x=>x,serverId:'bounds',responseTimeoutMs:1000,logger:pino({level:'silent'})}));
 const gateway=http.createServer(app),address=await listen(gateway);
 return {address,tracked,refuse(){refused=true;tracked.refuse('fixture','fixture refusal');},async close(){await close(gateway);await close(backend);}};
}
function call(f,suffix=''){
 const done=deferred();let head=false,bytes=0,body='',status,firstByteAt=null;const hash=createHash('sha256');
 const req=http.request(f.address+'/mcp/backends/fixture'+suffix,{method:'POST',headers:{authorization:'Bearer fake-only','content-type':'application/json'}},res=>{
  head=true;status=res.statusCode;res.on('data',b=>{firstByteAt??=Date.now();bytes+=b.length;hash.update(b);if(body.length<512)body+=b.toString().slice(0,512-body.length);});
  res.on('end',()=>done.resolve({status,bytes,sha256:hash.digest('hex'),prefix:body,aborted:false}));
  res.on('aborted',()=>done.resolve({status,bytes,aborted:true}));res.on('error',()=>{});
 });req.on('error',e=>done.resolve({error:e.code}));req.end('{"id":1,"method":"tools/call"}');
 return {req,done:done.promise,snapshot:()=>({head,bytes,status,firstByteAt})};
}
const limit=16*1024*1024, chunk=Buffer.alloc(64*1024,'x');
for(const kind of ['json','sse'])for(const size of [limit,limit+1,32*1024*1024])for(const mode of ['session','outside','drain']){
 const prefix=(kind==='sse'?'event: message\ndata: ':'')+'{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"';
 const suffix='"}]}}'+(kind==='sse'?'\n\n':'');
 const padding=size-Buffer.byteLength(prefix)-Buffer.byteLength(suffix),uploaded=deferred(),release=deferred();
 const expected=createHash('sha256');expected.update(prefix);let remaining=padding;while(remaining){const n=Math.min(remaining,chunk.length);expected.update(chunk.subarray(0,n));remaining-=n;}expected.update(suffix);
 const expectedHash=expected.digest('hex');
 const f=await fixture(async(req,res)=>{
  res.writeHead(200,{'content-type':kind==='sse'?'text/event-stream':'application/json'});res.flushHeaders();
  await write(res,Buffer.from(prefix));let left=padding;while(left){const n=Math.min(left,chunk.length);if(!await write(res,chunk.subarray(0,n)))break;left-=n;}
  uploaded.resolve();await release.promise;if(!res.destroyed)res.end(suffix);
 },mode);
 try{
  global.gc?.();const baseline=process.memoryUsage().arrayBuffers;const c=call(f);
  await uploaded.promise;await delay(120);global.gc?.();const heldBytes=process.memoryUsage().arrayBuffers-baseline,beforeEnd=c.snapshot();
  release.resolve();const result=await c.done;
  // Session mode bounds a finite answer (502) and a single held event (error event) at 16 MiB; the SSE event is the whole answer less its blank line.
  const reject=mode==='session'&&(kind==='json'?size>limit:size-2>limit);
  assert.equal(result.status,reject&&kind==='json'?502:200);assert.equal(result.aborted,false);
  if(reject){assert.match(result.prefix,/more than 16 MiB/);assert.ok(result.bytes<512);}else{assert.equal(result.bytes,size);assert.equal(result.sha256,expectedHash);}
  console.log(JSON.stringify({kind,size,mode,beforeEnd,heldBytes,status:result.status,receivedBytes:result.bytes,byteIdentical:result.sha256===expectedHash,error:reject?(kind==='json'?JSON.parse(result.prefix):result.prefix):undefined}));
 }finally{release.resolve();await f.close();}
}
for(const kind of ['json','sse']){
 let slowRes,timer;const begun=deferred();
 const f=await fixture(async(req,res)=>{
  if(req.url==='/fast'){res.writeHead(200,{'content-type':'application/json'}).end('{"fast":true}');return;}
  slowRes=res;res.writeHead(200,{'content-type':kind==='sse'?'text/event-stream':'application/json'});res.flushHeaders();res.write(kind==='sse'?'data: ':'{"text":"');
  timer=setInterval(()=>res.write('x'),25);begun.resolve();res.once('close',()=>clearInterval(timer));
 });
 try{
  const started=Date.now(),c=call(f);let settled=false;c.done.then(()=>settled=true);await begun.promise;await delay(500);clearInterval(timer);await delay(500);
  const fastStarted=Date.now(),fast=await call(f,'/fast').done;
  const beforeRefusal={elapsedMs:Date.now()-started,settled,trackedSlots:f.tracked.byAgent.get('fixture')?.size??0,backendOpen:!slowRes.destroyed,client:c.snapshot(),concurrentStatus:fast.status,concurrentMs:Date.now()-fastStarted};
  f.refuse();const refused=await c.done;await delay(10);
  console.log(JSON.stringify({kind,case:'slow-body-then-stall',headerTimeoutMs:50,beforeRefusal,refused,afterRefusalTrackedAgents:f.tracked.byAgent.size}));
 }finally{clearInterval(timer);await f.close();}
}
