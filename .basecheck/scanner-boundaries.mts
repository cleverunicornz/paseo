import {createHash} from 'node:crypto';
const {JsonRpcIdScanner,EventStreamRelay}=await import(process.cwd()+'/packages/server/src/server/mcp-gateway/refusal-stream.ts');
const inputs=[
 ['escaped-i',Buffer.from('{"\\u0069d":7,"method":"x"}')],
 ['escaped-d',Buffer.from('{"i\\u0064":8,"method":"x"}')],
 ['escaped-both',Buffer.from('{"\\u0069\\u0064":9,"method":"x"}')],
 ['duplicate-id',Buffer.from('{"id":7,"id":8,"method":"x"}')],
 ['duplicate-id-null',Buffer.from('{"id":7,"id":null,"method":"x"}')],
 ['nested-then-root',Buffer.from('{"params":{"id":99,"deep":[{"id":98,"data":"'+ 'x'.repeat(512*1024)+'"}]},"id":12,"method":"x"}')],
 ['mixed-batch',Buffer.from('[{"id":1,"method":"a"},{"method":"notice"},{"id":"two","params":{"id":99}},{"\\u0069d":3}]')],
 ['id-1024',Buffer.from(JSON.stringify({id:'x'.repeat(1024),method:'x'}))],
 ['id-1025',Buffer.from(JSON.stringify({id:'x'.repeat(1025),method:'x'}))],
 ['invalid-leading-zero',Buffer.from('{"id":01,"method":"x"}')],
 ['invalid-trailing-data',Buffer.from('{"id":7,"method":"x"}not JSON')],
 ['invalid-unclosed-body',Buffer.from('{"id":7,')],
 ['invalid-number',Buffer.from('{"id":1e,"method":"x"}')],
 ['invalid-utf8-id',Buffer.concat([Buffer.from('{"id":"'),Buffer.from([0xff]),Buffer.from('","method":"x"}')])],
 ['invalid-utf8-elsewhere',Buffer.concat([Buffer.from('{"params":"'),Buffer.from([0xc0,0xaf]),Buffer.from('","id":7}')])],
 ['escaped-string-id',Buffer.from('{"id":"quote\\\"-\\u2603","params":{"id":13}}')],
];
const summarize=(ids)=>ids.map(x=>typeof x==='string'&&x.length>80?{length:x.length,sha256:createHash('sha256').update(x).digest('hex')}:x);
for(const [name,bytes] of inputs){
 let parsed,validJSON=true,validUtf8=true;
 try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{validUtf8=false;}
 try{parsed=JSON.parse(bytes.toString('utf8'));}catch{validJSON=false;}
 const expected=validJSON?(Array.isArray(parsed)?parsed:[parsed]).filter(x=>x&&typeof x==='object'&&(typeof x.id==='string'||typeof x.id==='number')).map(x=>x.id):null;
 for(const chunkSize of [1,1023,65536]){
  const scanner=new JsonRpcIdScanner();
  for(let i=0;i<bytes.length;i+=chunkSize)scanner.push(bytes.subarray(i,i+chunkSize));
  scanner.end();console.log(JSON.stringify({name,chunkSize,validJSON,validUtf8,ids:summarize(scanner.ids),expected:expected&&summarize(expected),settled:scanner.settled}));
 }
}
const delayed=new JsonRpcIdScanner();delayed.push(Buffer.from('{"id":999,"params":'));
console.log(JSON.stringify({name:'duplicate-before-body-end',ids:delayed.ids,settled:delayed.settled}));
delayed.push(Buffer.from('{},"id":1}'));delayed.end();console.log(JSON.stringify({name:'duplicate-after-body-end',ids:delayed.ids,settled:delayed.settled}));
for(const lineEnd of ['\n','\r\n','\r']){
 const source=[': comment','event: message','data: {"jsonrpc":"2.0",','data: "id":7,"result":{}}','',''].join(lineEnd);
 for(const chunkSize of [1,2,17]){
  const relay=new EventStreamRelay();let output=Buffer.alloc(0);const bytes=Buffer.from(source);
  for(let i=0;i<bytes.length;i+=chunkSize)output=Buffer.concat([output,relay.take(bytes.subarray(i,i+chunkSize))]);
  console.log(JSON.stringify({name:'relay-framing',lineEnd,chunkSize,byteIdentical:output.equals(bytes),held:relay.rest().length}));
 }
}
