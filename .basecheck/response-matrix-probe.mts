import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root=process.cwd(), pino=createRequire(root+'/package.json')('pino');
const {createTestPaseoDaemon}=await import(root+'/packages/server/src/server/test-utils/paseo-daemon.ts');
const {createTestAgentClients}=await import(root+'/packages/server/src/server/test-utils/fake-agent-client.ts');
const {ClaudeAgentClient}=await import(root+'/packages/server/src/server/agent/providers/claude/agent.ts');
const {CodexAppServerAgentSession}=await import(root+'/packages/server/src/server/agent/providers/codex-app-server-agent.ts');
const {createFakeCodexAppServer}=await import(root+'/packages/server/src/server/agent/providers/codex/test-utils/fake-app-server.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn,label){for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('timeout '+label);}
function queue(){const frames=[];let waiter,closed=false;return {push(f){frames.push(f);waiter?.();},applyFlagSettings:async()=>{},async next(){while(!closed&&!frames.length)await new Promise(r=>waiter=r);return frames.length?{done:false,value:frames.shift()}:{done:true};},async return(){this.close();return {done:true};},async interrupt(){this.close();},close(){closed=true;waiter?.();},setPermissionMode:async()=>{},setModel:async()=>{},supportedModels:async()=>[],supportedCommands:async()=>[],[Symbol.asyncIterator](){return this;}};}
function frame(kind,model,child=false){
 const shared={session_id:'fixture-claude',parent_tool_use_id:child?'task-child':null};
 if(kind==='init')return {...shared,type:'system',subtype:'init',model,permissionMode:'default'};
 if(kind==='message_start')return {...shared,type:'stream_event',event:{type:'message_start',message:{id:'msg-switch',model,role:'assistant',content:[]}}};
 return {...shared,type:'assistant',message:{id:'msg-switch',model,role:'assistant',content:[{type:'tool_use',id:'parallel-1',name:'mcp__fixture__pr_read',input:{}},{type:'tool_use',id:'parallel-2',name:'mcp__fixture__pr_read',input:{}}]}};
}
async function scenario(provider,kind,inflight,answer){
 const complete=inflight==='complete'; const pendingResponses=[]; const headersReady=[deferred(),deferred()]; let aborted=0; const answerBodies=[];
 const allowed=provider==='claude'?'claude-opus-5-5':'gpt-6-astra';
 const switched=provider==='claude'?'claude-sonnet-5-5':'gpt-5.4';
 const clients=createTestAgentClients(); const q=queue(); let session,daemon,running,agentId;
 const app=provider==='codex'?createFakeCodexAppServer({'thread/loaded/list':()=>({data:['thread-1']}),'thread/unsubscribe':()=>({}),'turn/interrupt':()=>({})}):null;
 if(provider==='claude'){
  const real=new ClaudeAgentClient({logger:pino({level:'silent'}),resolveBinary:async()=>'/fixture/claude',queryFactory:()=>q});
  clients.claude.createSession=async(...args)=>{session=await real.createSession(...args);return session;};
 } else clients.codex.createSession=async(config,context)=>session=new CodexAppServerAgentSession(config,null,pino({level:'silent'}),async()=>app.child,{},false,false,false,context.agentId);
 const prefixes=[deferred(),deferred()], seen=[];let prefixIndex=0;
 const backend=http.createServer((req,res)=>{
  let body='';const slot=prefixIndex++;
  req.on('data',chunk=>{body+=chunk;if(!complete&&!res.headersSent){res.writeHead(200,{'content-type':answer==='sse'?'text/event-stream':'application/json'});res.write(answer==='sse'?': stream open\n\n':'{"partial":');}prefixes[slot]?.resolve();});
  req.on('end',()=>{seen.push({afterRefusal:!!daemon.daemon.agentManager.getSessionMemberRefusal(agentId),body:JSON.parse(body)});if(complete){res.writeHead(200,{'content-type':answer==='sse'?'text/event-stream':'application/json'});res.write(answer==='sse'?': stream open\n\n':'{"partial":');pendingResponses.push(res);}else res.end('{}');});
 });
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const holdClose=deferred();let restoreClose;
 try{
  daemon=await createTestPaseoDaemon({agentClients:clients,sessionRuntime:{timelineDrainMs:200,singleAgent:false,webBasePath:'/',identity:{member:provider+'/'+allowed,role:'validator'}},mcpGatewayBackends:{fixture:{url:'http://127.0.0.1:'+backend.address().port}}});
  const manager=daemon.daemon.agentManager;
  const agent=await manager.createAgent({provider,model:allowed,cwd:daemon.paseoHome,modeId:provider==='codex'?'full-access':undefined},undefined,{});agentId=agent.id;
  const token=manager.issueAgentToken(agentId);
  const url='http://127.0.0.1:'+daemon.port+'/mcp/backends/fixture';
  const call=()=>fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'pr_read'}})}).then(r=>r.status);
  const events=[];session.subscribe(e=>events.push(e));
  running=manager.runAgent(agentId,'read two things').catch(e=>e.message);
  if(provider==='claude'){q.push(frame('init',allowed));await until(()=>session.claudeSessionId==='fixture-claude','Claude init');}
  else {await app.waitForTurnStart();app.startsTurn({threadId:'thread-1',turnId:'turn-1'});}
  const report=(model,child=false)=>{
   if(provider==='claude')q.push(frame(kind,model,child));
   else app.child.stdout.write(JSON.stringify({method:kind,params:kind==='model/rerouted'?{threadId:child?'child-thread':'thread-1',fromModel:allowed,toModel:model,turnId:'turn-1',reason:'other'}:{threadId:child?'child-thread':'thread-1',threadSettings:{model,modelProvider:'openai'}}})+'\n');
  };
  // Child frames and Task input do not change the root model, then a real root report must still refuse.
  if(provider==='claude')q.push({type:'assistant',session_id:'fixture-claude',parent_tool_use_id:null,message:{id:'task-parent',model:allowed,content:[{type:'tool_use',id:'task-child',name:'Task',input:{model:switched,prompt:'child'}}]}});
  else app.startsSubAgent({callId:'task-child',threadId:'child-thread',agentPath:'0.1'});
  report(switched,true);
  await new Promise(r=>setTimeout(r,20));
  assert.equal(manager.getSessionMemberRefusal(agentId),null,'child report must not refuse root');
  assert.equal((await session.getRuntimeInfo()).model,allowed);
  let requests=[],statuses=[];
  if(inflight){
   // Open two ordinary streamed MCP requests. Wait until the proxy forwarded the prefix,
   // then report the switched model before either complete tool request reaches the backend.
   for(let i=0;i<2;i++){
    let request;
    statuses.push(new Promise((resolve,reject)=>{request=http.request(url,{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'}},res=>{headersReady[i].resolve();let answerBody='';res.on('data',chunk=>{answerBody+=chunk;answerBodies[i]=answerBody;});res.on('end',()=>resolve(res.statusCode));res.on('aborted',()=>{aborted++;resolve(res.statusCode);});res.on('error',()=>{});});request.on('error',reject);request.write('{"jsonrpc":"2.0","id":'+i+',"method":"tools/call","params":');}));
    requests.push(request); if(complete)request.end('{"name":"pr_read"}}');
   }
   await Promise.all(prefixes.map(p=>p.promise)); if(complete)await until(()=>seen.length===2,'both whole requests reached backend');
  }
  if(answer==='sse')await Promise.all(headersReady.map(x=>x.promise)); else await new Promise(r=>setTimeout(r,20));
  restoreClose=session.close.bind(session);session.close=async()=>{await holdClose.promise;return restoreClose();};
  report(switched);
  // Parallel requests from the model-reporting assistant message: no extra frame consumption.
  const parallel=inflight?[]:[call(),call()];
  await until(()=>manager.getSessionMemberRefusal(agentId)!==null,'member refusal');
  const refusedWhileClosing=await call();assert.equal(refusedWhileClosing,403);
  holdClose.resolve();await until(()=>manager.getAgent(agentId)===null,'agent close');
  if(complete)for(const res of pendingResponses)res.end('{}');
  if(inflight&&!complete)for(const req of requests)req.end('{"name":"pr_read"}}');
  const completed=await Promise.all(inflight?statuses:parallel);
  const afterClose=await call();assert.equal(afterClose,401);
  const error=await running;assert.match(error,/This session's member/);
  const modelEvents=events.filter(e=>e.type==='model_changed').map(e=>e.runtimeInfo.model);
  assert.ok(modelEvents.includes(switched));
  const row={provider,kind,inflight,answer,aborted,answerBodies,childIgnored:true,modelEvents,refusedWhileClosing,afterClose,toolStatuses:completed,backendCompleted:seen.length,completedAfterRefusal:seen.filter(x=>x.afterRefusal).length};
  console.log(JSON.stringify(row));
  if(!inflight){assert.deepEqual(completed,[403,403]);assert.equal(seen.length,0);}
  else {assert.deepEqual(completed,answer==='sse'?[200,200]:[403,403]);assert.equal(aborted,0);for(let i=0;i<2;i++){if(answer==='sse'){const events=answerBodies[i].split('\n').filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));assert.equal(events.length,1);assert.equal(events[0].id,i);assert.equal(events[0].error.code,-32003);assert.match(events[0].error.message,/This session's member/);}else assert.match(JSON.parse(answerBodies[i]).error,/This session's member/);}assert.equal(seen.length,complete?2:0);assert.equal(seen.filter(x=>x.afterRefusal).length,0);}
 } finally {holdClose.resolve();q.close();await daemon?.close();backend.closeAllConnections();await new Promise(r=>backend.close(r));}
}
for(const [provider,kind] of [['claude','init'],['claude','message_start'],['claude','assistant'],['codex','model/rerouted'],['codex','thread/settings/updated']]){
 for(const answer of ['sse','json']) {await scenario(provider,kind,true,answer);await scenario(provider,kind,'complete',answer);}
}
console.log('CHECKED: 20 report/body/answer cases; clean SSE -32003 events and finite HTTP403.');
