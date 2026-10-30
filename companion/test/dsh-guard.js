'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

function mockContext() {
  const definitions = new Map(), listeners = [], guards = [], services = new Map();
  return {definitions, listeners, guards, services,
    on(event, callback) {assert.equal(event, 'tools/pre-execute'); listeners.push(callback); return () => {};},
    provide(name, service) {services.set(name, service);},
    get(name) {return services.get(name);},
    tools: {
      get(name) {return definitions.get(name);},
      register(definition) {definitions.set(definition.name, definition); return () => definitions.delete(definition.name);},
      guard(callback) {guards.push(callback); return () => {};}
    }
  };
}
function execution(name = 'bash', args = {command: 'synthetic command; never executed'}) {
  return {name, arguments: args, callId: 'call-fixture', rootCallId: 'call-fixture',
    agent: {session: {id: 'owner-fixture-session'}}, signal: new AbortController().signal};
}
async function pipeline(ctx, exec, shortcut = false) {
  let result = shortcut ? {kind: 'allow'} : await ctx.listeners[0](exec, async () => ({kind: 'allow'}));
  if (result.kind !== 'allow') return result;
  const reason = ctx.guards[0](exec);
  return reason ? {kind: 'deny', reason} : {kind: 'allow'};
}

(async () => {
  const {installGuard, canonicalArguments, validateGuardEndpoint, createReadOnlyTools} =
    await import(pathToFileURL(path.resolve(__dirname, '../src/dsh-guard.mjs')));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lilith-guard-'));
  const home = path.join(root, 'home'), ordinary = path.join(root, 'ordinary');
  const protectedRoot = path.join(root, 'application-data');
  for (const directory of [home, ordinary, protectedRoot, path.join(home, '.dsh'), path.join(home, '.codex')]) fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(path.join(ordinary, 'note.txt'), '你好，莉莉丝。');
  fs.writeFileSync(path.join(protectedRoot, 'runtime.json'), 'test-only protected value');
  fs.writeFileSync(path.join(home, '.dsh', '.credentials.yaml'), 'test-only protected value');
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'test-only protected value');
  fs.writeFileSync(path.join(ordinary, '.env'), 'test-only protected value');
  fs.symlinkSync(protectedRoot, path.join(ordinary, 'alias-data'));
  fs.symlinkSync(path.join(home, '.codex'), path.join(ordinary, 'alias-codex'));
  fs.symlinkSync(path.join(ordinary, 'note.txt'), path.join(ordinary, 'ordinary-link'));
  fs.writeFileSync(path.join(ordinary, 'oversized.txt'), Buffer.alloc(256 * 1024 + 1, 65));
  fs.writeFileSync(path.join(ordinary, 'binary.bin'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(ordinary, 'invalid.txt'), Buffer.from([0xc0, 0xaf]));
  const token = 'test-only-lilith-guard-bearer';
  let responder = 'allow', requests = [], responseMode = '', pendingResponse;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + token);
    assert.equal(req.url, '/v1/dsh/guard'); assert.equal(req.method, 'POST');
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const request = JSON.parse(Buffer.concat(chunks)); requests.push(request);
      if (responder === 'pending') {pendingResponse = res; return;}
      if (responder === 'redirect') {res.writeHead(302, {location: '/never-follow'}); return res.end();}
      if (responder === 'oversized') return res.end(' '.repeat(32769));
      if (responder === 'malformed') return res.end('invalid-json');
      const response = {...request, approved: responder === 'allow' && request.arguments?.fixture_deny !== true, expires_at: Date.now() + 30000};
      if (responseMode === 'wrong-id') response.request_id = 'different-request';
      if (responseMode === 'wrong-session') response.session_id = 'other-session';
      if (responseMode === 'wrong-args') response.arguments_sha256 = '0'.repeat(64);
      if (responseMode === 'wrong-workspace') response.workspace = '/different-workspace';
      if (responseMode === 'expired') response.expires_at = Date.now() - 1;
      if (responseMode === 'string-approved') response.approved = 'true';
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/dsh/guard`;
  try {
    assert.equal(canonicalArguments({b: 2, a: ['x', true]}), '{"a":["x",true],"b":2}');
    assert.equal(canonicalArguments({z: 1, a: 2}), canonicalArguments({a: 2, z: 1}));
    assert.throws(() => canonicalArguments({a: undefined}), /invalid_arguments/);
    for (const endpoint of ['https://127.0.0.1:3000', 'http://localhost:3000', 'http://example.com:3000',
      'http://127.0.0.1:3000/bad', 'http://user@127.0.0.1:3000', 'http://127.0.0.1:3000/?token=x'])
      assert.throws(() => validateGuardEndpoint(endpoint), /endpoint_invalid/);
    const ctx = mockContext();
    installGuard(ctx, {url, token, home, cwd: ordinary, protectedPaths: [protectedRoot], timeoutMs: 200});
    assert.deepEqual(ctx.services.get('lilithGuardReady'), {ready: true, policy: 'exact-operation-v1', all_tools_use_host_gate: true});
    let exec = execution();
    assert.equal((await pipeline(ctx, exec)).kind, 'allow');
    assert.equal(ctx.guards[0](exec), 'lilith_guard_confirmation_required', 'grant cannot be replayed');
    assert.equal(requests.at(-1).trusted_readonly, false);
    assert.match(requests.at(-1).arguments_sha256, /^[0-9a-f]{64}$/);
    assert.equal(requests.at(-1).workspace, fs.realpathSync(ordinary));
    assert.equal((await pipeline(ctx, execution(), true)).kind, 'deny', 'short-circuit allow never bypasses guard');
    for (const mode of ['wrong-id', 'wrong-session', 'wrong-args', 'wrong-workspace', 'expired', 'string-approved']) {
      responseMode = mode;
      assert.equal((await pipeline(ctx, execution())).kind, 'deny', mode);
    }
    responseMode = '';
    for (const mode of ['deny', 'redirect', 'oversized', 'malformed']) {
      responder = mode; assert.equal((await pipeline(ctx, execution())).kind, 'deny', mode);
    }
    responder = 'allow';
    exec = execution(); let prepared = await ctx.listeners[0](exec, async () => ({kind: 'allow'}));
    assert.equal(prepared.kind, 'allow'); exec.arguments = {command: 'changed'};
    assert.equal(ctx.guards[0](exec), 'lilith_guard_operation_changed', 'argument changes invalidate exact grant');
    exec = execution('lilith_read', {path: 'note.txt'});
    assert.equal((await pipeline(ctx, exec)).kind, 'allow'); assert.equal(requests.at(-1).trusted_readonly, true);
    assert.equal(requests.at(-1).readonly_policy, 'lilith-readonly-v1');
    const original = ctx.definitions.get('lilith_read');
    assert.ok(Object.isFrozen(original)); assert.ok(Object.isFrozen(original.parameters));
    assert.throws(() => {original.execute = () => ({unsafe: true});}, TypeError, 'trusted definition cannot be mutated in place');
    ctx.definitions.set('lilith_read', {...original});
    await pipeline(ctx, execution('lilith_read', {path: 'note.txt'}));
    assert.equal(requests.at(-1).trusted_readonly, false, 'same-name replacement cannot claim trusted read-only origin');
    ctx.definitions.set('lilith_read', original);
    exec = execution('lilith_read', {path: 'note.txt'});
    prepared = await ctx.listeners[0](exec, async () => ({kind: 'allow'}));
    assert.equal(prepared.kind, 'allow'); ctx.definitions.set('lilith_read', {...original});
    assert.equal(ctx.guards[0](exec), 'lilith_guard_operation_changed'); ctx.definitions.set('lilith_read', original);
    exec = execution(); delete exec.agent;
    const beforeMissing = requests.length;
    assert.equal((await pipeline(ctx, exec)).kind, 'deny'); assert.equal(requests.length, beforeMissing);
    responder = 'pending';
    const controller = new AbortController(); exec = {...execution(), signal: controller.signal};
    const waiting = pipeline(ctx, exec);
    while (!pendingResponse) await new Promise(resolve => setTimeout(resolve, 2));
    controller.abort(); assert.equal((await waiting).kind, 'deny'); pendingResponse.destroy(); pendingResponse = null;
    assert.equal(ctx.guards[0](exec), 'lilith_guard_confirmation_required');
    const shortCtx = mockContext(); installGuard(shortCtx, {url, token, home, cwd: ordinary, timeoutMs: 10});
    assert.equal((await pipeline(shortCtx, execution())).kind, 'deny', 'unanswered IPC fails closed on timeout');
    pendingResponse?.destroy(); pendingResponse = null; responder = 'allow';
    const files = createReadOnlyTools({home, protectedPaths: [protectedRoot], cwd: ordinary});
    assert.equal((await files.read({path: 'note.txt'})).text, '你好，莉莉丝。');
    assert.equal((await files.read({path: 'ordinary-link'})).text, '你好，莉莉丝。');
    for (const file of ['.env', 'alias-data/runtime.json', 'alias-codex/config.toml', path.join(home, '.dsh', '.credentials.yaml')])
      await assert.rejects(files.read({path: file}), /protected_path/);
    for (const file of ['oversized.txt', 'binary.bin', 'invalid.txt']) await assert.rejects(files.read({path: file}), /not_plain_small_file|not_utf8/);
    fs.linkSync(path.join(ordinary, 'note.txt'), path.join(ordinary, 'hard-link'));
    await assert.rejects(files.read({path: 'hard-link'}), /not_plain_small_file/);
    const listing = await files.list({path: '.'});
    assert.ok(!listing.entries.some(entry => ['.env', 'alias-data', 'alias-codex'].includes(entry.name)));
    assert.ok(listing.entries.some(entry => entry.name === 'note.txt'));
    await assert.rejects(files.list({path: 'alias-data'}), /protected_path/);
    const readOnlyBody = original.execute;
    await assert.rejects(readOnlyBody({path: 'alias-data/runtime.json'}, execution()), /protected_path/);

    // Optional actual-shipped-runtime probe. The only body increments memory;
    // it never uses the model, credentials, shell commands, or external I/O.
    const electron = process.env.LILITH_DSH_GUARD_TEST_ELECTRON;
    if (electron) {
      const asarPackages = path.join(path.dirname(electron), '../Resources/app.asar/dsh/node_modules/@deepseek-ai/');
      const script = `const p=${JSON.stringify(asarPackages)};const {Context}=await import(p+'cordis/lib/index.mjs').catch(()=>import(p+'cordis/lib/index.js'));const {ToolRuntime}=await import(p+'dsh-tools/lib/index.js');const {installGuard}=await import(${JSON.stringify(pathToFileURL(path.resolve(__dirname, '../src/dsh-guard.mjs')).href)});const ctx=new Context();ctx.provide('systemPrompt',{tools(){}});ctx.plugin(ToolRuntime);await new Promise(r=>setTimeout(r,20));installGuard(ctx,{url:${JSON.stringify(url)},token:${JSON.stringify(token)},home:${JSON.stringify(home)},cwd:${JSON.stringify(ordinary)}});let bodies=0;ctx.tools.register({name:'safe_counter',description:'Only increments memory',parameters:{type:'object',properties:{fixture_deny:{type:'boolean'}}},output:{schema:{type:'integer'},render:(a,v)=>[{type:'text',text:String(v)}]},execute(){return ++bodies}});const agent={session:{id:'owner-fixture-session'}};const call=async(id,args)=>ctx.tools.execute({name:'safe_counter',arguments:args,callId:id,agent,signal:new AbortController().signal});const allowed=await call('actual-shipped-safe-probe',{});const denied=await call('actual-shipped-denied-probe',{fixture_deny:true});ctx.tools.guard(()=> 'TEST_ADDITIONAL_MONOTONIC_VETO');const vetoed=await call('actual-shipped-vetoed-probe',{});console.log(JSON.stringify({bodies,allowed:!allowed.isError,denied:!!denied.isError,vetoed:!!vetoed.isError}));`;
      const {stdout} = await promisify(execFile)(electron, ['--expose-internals', '--input-type=module', '-e', script],
        {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8', timeout: 15000});
      const row = JSON.parse(stdout.trim().split('\n').at(-1));
      assert.deepEqual(row, {bodies: 1, allowed: true, denied: true, vetoed: true});
    }
    console.log('dsh-guard: authenticated exact-call grants, one-shot monotonic veto, abort/expiry/failure closure, definition identity and protected global read tools passed.');
  } finally {
    pendingResponse?.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
