import net from 'node:net';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {w3cwebsocket:WebSocket}=require('websocket');
const targets=[
  [1,'149.154.175.53','pluto'],[2,'149.154.167.51','venus'],
  [3,'149.154.175.100','aurora'],[4,'149.154.167.91','vesta'],[5,'91.108.56.130','flora'],
];
const timeoutMs=8000;
function probe(dc,host,transport){
 return new Promise(resolve=>{
  const started=Date.now();let done=false,socket;
  const finish=(ok,error)=>{
   if(done)return;done=true;clearTimeout(timer);
   try{transport==='tcp'?socket?.destroy():socket?.close();}catch{}
   resolve({dc,host,transport,ok,elapsedMs:Date.now()-started,error});
  };
  const timer=setTimeout(()=>finish(false,'TIMEOUT'),timeoutMs);
  if(transport==='tcp'){
   socket=net.createConnection({host,port:443});
   socket.once('connect',()=>finish(true));
   socket.once('error',error=>finish(false,error.code||error.name));
  }else{
   socket=new WebSocket(`wss://${host}/apiws`,'binary');
   socket.onopen=()=>finish(true);
   socket.onerror=()=>finish(false,'WEBSOCKET_HANDSHAKE_FAILED');
  }
 });
}
const probes=targets.flatMap(([dc,ip,name])=>[probe(dc,ip,'tcp'),probe(dc,`${name}.web.telegram.org`,'websocket')]);
console.log(JSON.stringify(await Promise.all(probes),null,2));
