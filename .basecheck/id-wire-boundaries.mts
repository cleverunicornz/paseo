import http from 'node:http';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const root=process.cwd(),require=createRequire(root+'/packages/server/package.json');
const express=require('express'),pino=require('pino');
const {createMcpGatewayHandler,McpGatewayRequests}=await import(root+'/packages/server/src/server/mcp-gateway/mcp-gateway.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function listen(s){await new Promise(r=>s.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+s.address().port;}
async function close(s){s.closeAllConnections();await new Promise(r=>s.close(r));}
const cases=[
 {name:'mixed-batch',body:'[{"id":1,"method":"x"},{"jsonrpc":"2.0","method":"notice"},{"id":"two","params":{"id":99}},{"id":3}]'},
 {name:'escaped-batch-key',body:String.raw`[{"id":1,"method":"x"},{"method":"notice"},{"\u0069d":2}]`},
 {name:'notification',body:'{"jsonrpc":"2.0","method":"notifications/initialized"}'},
 {name:'GET-stream',body:'',method:'GET'},
 {name:'id-1024',body:JSON.stringify({id:'x'.repeat(1024),method:'x'})},
 {name:'id-1025',body:JSON.stringify({id:'x'.repeat(1025),method:'x'})},
 {name:'invalid-json',body:'{"id":7,'},
 {name:'non-utf8',body:Buffer.concat([Buffer.from('{"id":"'),Buffer.from([255]),Buffer.from('","method":"x"}')])},
 {name:'late-id',body:'{"params":{},',tail:'"id":12}',after:35},
 {name:'id-never-arrives',body:'{"params":{},',tail:'"id":12}',after:200},
];
for(const test of cases){
 const tracked=new McpGatewayRequests(),head=deferred(),done=deferred();let refused=false,endedUpstream=false;
 const backend=http.createServer((req,res)=>{req.on('error',()=>{});req.resume();req.on('end',()=>endedUpstream=true);res.writeHead(200,{'content-type':'text/event-stream'});res.write(': ready\n\n');});
 const url=await listen(backend),app=express();app.use('/mcp/backends',createMcpGatewayHandler({getBackends:()=>new Map([['fixture',{url}]]),resolveAgent:()=>({agentId:'fixture',sessionId:'s',workspaceId:null}),sessionIdentity:{member:'claude/claude-opus-5-5',role:'validator'},agentRefusal:()=>refused?'fixture refusal':null,requests:tracked,resolveUpstream:async x=>x,serverId:'ids',responseTimeoutMs:80,logger:pino({level:'silent'})}));
 const gateway=http.createServer(app),address=await listen(gateway);
 let text='',status,timer;
 const req=http.request(address+'/mcp/backends/fixture',{method:test.method??'POST',headers:{authorization:'Bearer fake-only','content-type':'application/json'}},res=>{status=res.statusCode;res.on('data',b=>text+=b);res.on('end',()=>done.resolve('end'));res.on('error',e=>done.resolve(e.code));head.resolve();});
 req.on('error',e=>done.resolve(e.code));if(test.tail)req.write(test.body);else req.end(test.body);
 try{
  await head.promise;await delay(10);const before=endedUpstream,start=Date.now();refused=true;tracked.refuse('fixture','fixture refusal');
  if(test.tail)timer=setTimeout(()=>{try{req.end(test.tail);}catch{}},test.after);
  const finish=await done.promise;const events=text.split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));
  console.log(JSON.stringify({name:test.name,status,finish,elapsedAfterRefusal:Date.now()-start,ids:events.map(x=>typeof x.id==='string'&&x.id.length>80?{length:x.id.length}:x.id),codes:events.map(x=>x.error?.code),backendCompleteBeforeRefusal:before,backendCompleteAfterRefusal:!before&&endedUpstream,trackedAgents:tracked.byAgent.size}));
 }finally{clearTimeout(timer);req.destroy();await close(gateway);await close(backend);}
}
