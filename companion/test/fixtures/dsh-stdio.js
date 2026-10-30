'use strict';
const readline=require('node:readline');let session='',completed=false,waiting=[];const opened=new Set();
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
const reply=(id,result={})=>send({jsonrpc:'2.0',id,result});
readline.createInterface({input:process.stdin}).on('line',line=>{const f=JSON.parse(line);
  if(f.method==='initialize')reply(f.id,{serverInfo:{name:'test-only-runtime'}});
  if(f.method==='session/resume'){
    if(opened.has(f.params.sessionId))send({jsonrpc:'2.0',id:f.id,error:{message:'SDK session is already open or opening'}});
    else if(f.params.sessionId==='resume-error')send({jsonrpc:'2.0',id:f.id,error:{message:'Session not found'}});
    else {opened.add(f.params.sessionId);reply(f.id);}
  }
  if(f.method==='session/prompt'){
    opened.add(f.params.sessionId);
    session=f.params.sessionId;reply(f.id,{messageId:'fixture'});completed=false;
    if(f.params.contentBlocks[0].text==='hold')return;
    setTimeout(()=>{
      const frame=Buffer.from(JSON.stringify({jsonrpc:'2.0',method:'session.event',params:{sessionId:session,event:{type:'assistant/message',data:{content:[{type:'text',text:'中文结果'}]}}}})+'\n');
      const index=frame.indexOf(Buffer.from('中文'))+1;process.stdout.write(frame.subarray(0,index));process.stdout.write(frame.subarray(index));
      send({jsonrpc:'2.0',method:'session.event',params:{sessionId:session,event:{type:'turn/end',data:{reason:{kind:'completed'}}}}});
      completed=true;for(const id of waiting)reply(id);waiting=[];
    },20);
  }
  if(f.method==='session/wait'){if(completed)reply(f.id);else waiting.push(f.id);}
  if(f.method==='shutdown'){reply(f.id);setTimeout(()=>process.exit(0),5);}
});
