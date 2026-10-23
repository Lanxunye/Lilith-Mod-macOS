'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const {DshRuntime}=require('../src/dsh-runtime');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lilith-rpc-'));let client;
(async()=>{try{
  const messages=[];client=new DshRuntime({executable:'fixture',home:root,workspace:root,policy:{workspace:root,allowWrite:false},
    provider:{api_key:'test-only-key'},model:'fixture',onEvent:(m,p)=>messages.push(p),
    spawnProcess:(exe,args,options)=>{assert.ok(!args.join(' ').includes('test-only-key'));assert.equal(options.env.DEEPSEEK_API_KEY,'test-only-key');
      return spawn(process.execPath,[path.join(__dirname,'fixtures/dsh-stdio.js')],options);}});
  await client.run('fixture','run');assert.equal(messages[0].event.data.content[0].text,'中文结果');
  await assert.rejects(client.rpc('never',{},20),/timeout/);assert.equal(client.pending.size,0);
  await client.close();assert.equal(client.exited,true);
  const patch=fs.readFileSync(path.join(root,'lilith.patch.yml'),'utf8');assert.ok(!patch.includes('test-only-key'));assert.match(patch,/session-telemetry-otel\n  disabled: true/);
  client=new DshRuntime({executable:'fixture',home:root,workspace:root,policy:{workspace:root},provider:{api_key:'fake'},model:'fake',
    spawnProcess:(exe,args,options)=>spawn(process.execPath,[path.join(__dirname,'fixtures/dsh-stdio.js')],options)});
  const running=client.run('hold-session','hold');const rejection=assert.rejects(running,/closed/);
  await new Promise(r=>setTimeout(r,80));await client.stop();await rejection;
  console.log('dsh-runtime: real subprocess JSON-RPC framing, split UTF-8, timeout cleanup, shutdown and cancellation passed.');
}finally{await client?.stop();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
