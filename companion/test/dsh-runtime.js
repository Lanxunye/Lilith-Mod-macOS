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
  const resumed=[],rpc=client.rpc.bind(client);client.rpc=(method,...args)=>{if(method==='session/resume')resumed.push(args[0].sessionId);return rpc(method,...args);};
  await client.run('fixture','second turn',true);
  await client.run('other','other session');
  await client.run('fixture','return to first session',true);
  assert.deepEqual(resumed,[],'already-open sessions must not be resumed again');
  await client.run('persisted','restore on this process',true);
  await client.run('persisted','follow-up after restoration',true);
  assert.deepEqual(resumed,['persisted'],'each process restores a persisted session only once');
  await assert.rejects(client.run('resume-error','must fail',true),e=>e.code==='dsh_rpc_error'&&e.detail==='Session not found');
  assert.equal(client.openedSessions.has('resume-error'),false,'failed restoration must not mark the session open');
  await assert.rejects(client.rpc('never',{},20),/timeout/);assert.equal(client.pending.size,0);
  await client.close();assert.equal(client.exited,true);
  const patch=fs.readFileSync(path.join(root,'lilith.patch.yml'),'utf8');assert.ok(!patch.includes('test-only-key'));assert.match(patch,/session-telemetry-otel\n  disabled: true/);
  client=new DshRuntime({executable:'fixture',home:root,workspace:root,policy:{workspace:root},provider:{api_key:'fake'},model:'fake',
    spawnProcess:(exe,args,options)=>spawn(process.execPath,[path.join(__dirname,'fixtures/dsh-stdio.js')],options)});
  assert.equal(client.openedSessions.has('persisted'),false);
  await client.run('persisted','restore after process restart',true);
  await client.run('persisted','follow-up after process restart',true);
  const running=client.run('hold-session','hold');const rejection=assert.rejects(running,/closed/);
  await new Promise(r=>setTimeout(r,80));await client.stop();await rejection;
  console.log('dsh-runtime: JSON-RPC/UTF-8, repeated turns, session switching, process restart restoration, resume errors, timeout cleanup and cancellation passed.');
}finally{await client?.stop();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
