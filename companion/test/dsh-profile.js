'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {prepareDshProfile, safeConfig, pluginRows} = require('../src/dsh-profile');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lilith-dsh-profile-test-'));
try {
  const sourceHome = path.join(root, 'native'), sdk = path.join(sourceHome, 'profiles', 'sdk');
  const desktop = path.join(sourceHome, 'profiles', 'desktop'), home = path.join(root, 'isolated');
  fs.mkdirSync(sdk, {recursive: true}); fs.mkdirSync(desktop, {recursive: true});
  const credentialPath = path.join(sourceHome, '.credentials.yaml');
  fs.writeFileSync(credentialPath, 'TEST CREDENTIAL BYTES MUST NEVER BE OPENED');
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({dependencies: {'fixture-plugin': '1.2.3'},
    dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app', 'fixture-bundle']}}}));
  fs.writeFileSync(path.join(sdk, 'cordis.patch.yml'), '[]\n');
  fs.mkdirSync(path.join(sdk, 'node_modules'));
  fs.mkdirSync(path.join(sdk, 'node_modules', 'fixture-plugin'));
  fs.writeFileSync(path.join(desktop, 'cordis.patch.yml'), `- insert:
    - name: '@deepseek-ai/dsh-client-ui-settings'
      config:
        enabled: true
    - name: '@deepseek-ai/dsh-agent-default-model'
      config:
        provider: native-provider
        model: native-model
        reasoningEffort: high
    - name: '@deepseek-ai/dsh-llm-pi-ai'
      config:
        providers:
          native-provider:
            apiKeyEnv: NATIVE_PROVIDER_KEY
            api: openai-completions
            baseURL: https://model.example/v1
            models:
              - id: native-model
                name: Native model
    - name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fixture
        transport: stdio
        command: node
        args: ['fixture.mjs']
    - name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: unsafe
        env:
          PLUGIN_API_KEY: ${'sk-' + 'do-not-copy-this-fixture-key'}
`);
  const nativeBefore = fs.readFileSync(path.join(desktop, 'cordis.patch.yml'));
  const guardPlugin = path.join(root, 'guard.mjs'); fs.writeFileSync(guardPlugin, '// fixture');
  const reads = [];
  const io = Object.create(fs);
  io.readFileSync = (...args) => { reads.push(args[0]); assert.notEqual(args[0], credentialPath); return fs.readFileSync(...args); };
  const input = {home, workspace: path.join(root, 'workspace'), sourceHome, guardPlugin,
    guardEndpoint: 'http://127.0.0.1:1234/v1/dsh/guard', guardToken: 'fixture-guard-token-0000', persona: '莉莉丝固定人设', fsImpl: io};
  const result = prepareDshProfile(input), overlay = fs.readFileSync(result.patchFile, 'utf8');
  const userPatchPath = path.join(home, 'profiles', result.profile, 'cordis.patch.yml');
  const patch = fs.readFileSync(userPatchPath, 'utf8') + overlay;
  assert.equal(result.provider, 'native-provider'); assert.equal(result.model, 'native-model');
  assert.equal(result.reasoningEffort, 'high'); assert.equal(result.status.native_model_selected, true);
  assert.equal(result.status.auth_configured, true); assert.equal(result.status.auth_verified, false);
  assert.equal(result.status.native_dependency_count, 1); assert.equal(result.status.bundle_count, 3);
  assert.equal(result.status.migrated_plugin_count, 3); assert.equal(result.status.mcp_count, 1);
  assert.equal(result.status.skipped_plugin_count, 1);
  assert.match(patch, /lilithGuardReady/); assert.match(patch, /defaultPreset: lilith-full-access/);
  assert.match(patch, /policy: ask/); assert.match(patch, /mode: danger-full-access/);
  assert.match(patch, /path: .*\.credentials\.yaml/); assert.match(patch, /apiKeyEnv: NATIVE_PROVIDER_KEY/);
  assert.match(patch, /\n            name: Native model\n/);
  assert.doesNotMatch(patch, /sk-do-not|TEST CREDENTIAL|client-ui-settings/);
  assert.equal(reads.includes(credentialPath), false);
  assert.equal(Object.keys(result.env).some(k => /API_KEY/.test(k)), false);
  assert.equal(result.env.LILITH_DSH_GUARD_TOKEN, input.guardToken);
  const localModules = path.join(home, 'profiles', result.profile, 'node_modules');
  assert.equal(fs.lstatSync(localModules).isSymbolicLink(), false);
  assert.equal(fs.realpathSync(path.join(localModules, 'fixture-plugin')), fs.realpathSync(path.join(sdk, 'node_modules', 'fixture-plugin')));
  const copied = JSON.parse(fs.readFileSync(path.join(home, 'profiles', result.profile, 'package.json')));
  assert.equal(copied.dependencies['fixture-plugin'], '1.2.3');
  const localManifestPath = path.join(home, 'profiles', result.profile, 'package.json');
  copied.dependencies['new-trusted-local-plugin'] = '2.0.0';
  copied.dsh.profile.bundles.push('local-trusted-bundle');
  fs.writeFileSync(localManifestPath, JSON.stringify(copied, null, 2) + '\n');
  fs.appendFileSync(userPatchPath, `\n# User-owned local plugin configuration remains byte-for-byte.\n- insert:\n    - id: local-demo\n      name: ./trusted-demo.mjs\n- id: agent-default-model\n  config:\n    provider: local-provider\n    model: local-model\n- id: sdk-jsonrpc-server\n  disabled: true\n  inject: []\n- id: approval\n  config:\n    policy: never\n`);
  const ownedManifestBytes = fs.readFileSync(localManifestPath), ownedPatchBytes = fs.readFileSync(userPatchPath);
  const again = prepareDshProfile(input), enforced = fs.readFileSync(again.patchFile, 'utf8');
  assert.deepEqual(fs.readFileSync(localManifestPath), ownedManifestBytes);
  assert.deepEqual(fs.readFileSync(userPatchPath), ownedPatchBytes);
  assert.equal(again.provider, 'local-provider'); assert.equal(again.model, 'local-model');
  assert.equal(again.status.local_profile_preserved, true);
  assert.match(enforced, /- id: sdk-jsonrpc-server\n  disabled: false\n  name: .*\n  inject: \[sdkAppStartup, loader, lilithGuardReady\]/);
  assert.match(enforced, /- id: approval\n  disabled: false[\s\S]*?policy: ask/);
  assert.match(enforced, /- id: lilith-safety-guard\n  disabled: false/);
  // A legacy whole-directory link is retired without modifying native packages.
  fs.unlinkSync(path.join(localModules, 'fixture-plugin')); fs.rmdirSync(localModules);
  fs.symlinkSync(path.join(sdk, 'node_modules'), localModules, 'dir');
  prepareDshProfile(input);
  assert.equal(fs.lstatSync(localModules).isSymbolicLink(), false);
  assert.equal(fs.existsSync(path.join(sdk, 'node_modules', 'fixture-plugin')), true);
  assert.deepEqual(fs.readFileSync(path.join(desktop, 'cordis.patch.yml')), nativeBefore);
  assert.throws(() => prepareDshProfile({...input, home: sourceHome}), /must_be_isolated/);
  assert.throws(() => prepareDshProfile({...input, home: path.join(sourceHome, 'nested')}), /must_be_isolated/);
  assert.throws(() => prepareDshProfile({...input, guardEndpoint: 'https://remote.example/guard'}), /loopback/);
  assert.throws(() => prepareDshProfile({...input, guardToken: ''}), /token_required/);
  assert.equal(safeConfig(['apiKey: plain-fixture-secret']), false);
  assert.equal(safeConfig(['env:', '  ACCESS_TOKEN: plain-fixture-secret']), false);
  assert.equal(safeConfig(['url: https://user:pass@example.com']), false);
  assert.equal(safeConfig(['apiKeyEnv: NATIVE_PROVIDER_KEY']), true);
  assert.equal(safeConfig(['value: !!js process.env.TOKEN']), false);
  assert.equal(pluginRows('- name: "@deepseek-ai/dsh-agent-default-model"\n  config:\n    model: "fixture"\n')[0].config[0], 'model: "fixture"');
  const fallback = prepareDshProfile({...input, home: path.join(root, 'fallback'), sourceHome: path.join(root, 'absent')});
  assert.equal(fallback.model, 'deepseek-flash'); assert.equal(fallback.status.auth_configured, false);
  assert.equal(fallback.status.native_model_selected, false);
  const moodPackage=path.join(localModules,'dsh-feiyu-mood');fs.mkdirSync(moodPackage,{recursive:true});
  const withMood=JSON.parse(fs.readFileSync(localManifestPath,'utf8'));withMood.dsh.profile.bundles.push('dsh-feiyu-mood');
  fs.writeFileSync(localManifestPath,JSON.stringify(withMood));
  fs.writeFileSync(path.join(moodPackage,'package.json'),JSON.stringify({version:'0.7.0-lilith.1',lilithAdaptation:{adaptation:'lilith-sdk.1'}}));
  const moodReady=prepareDshProfile(input);assert.equal(moodReady.status.mood.installed,true);
  assert.match(fs.readFileSync(moodReady.patchFile,'utf8'),/lilithGuardReady, lilithMoodReady/);
  fs.writeFileSync(path.join(moodPackage,'package.json'),JSON.stringify({version:'0.7.0'}));
  assert.throws(()=>prepareDshProfile(input),/lilith_mood_unadapted_package/);
  fs.writeFileSync(localManifestPath,JSON.stringify({...withMood,dsh:{profile:{bundles:withMood.dsh.profile.bundles.filter(x=>x!=='dsh-feiyu-mood')}}}));
  const fish=JSON.parse(fs.readFileSync(localManifestPath));fish.dsh.profile.bundles.push('dsh-fish-memory');
  fs.writeFileSync(localManifestPath,JSON.stringify(fish));const fishDir=path.join(localModules,'dsh-fish-memory');fs.mkdirSync(fishDir);
  fs.writeFileSync(path.join(fishDir,'package.json'),JSON.stringify({version:'1.2.6-lilith.1',lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
  const memoryReady=prepareDshProfile(input);assert.equal(memoryReady.status.memory.installed,true);
  assert.match(fs.readFileSync(memoryReady.patchFile,'utf8'),/lilithMemoryReady/);
  fs.writeFileSync(path.join(fishDir,'package.json'),JSON.stringify({version:'1.2.6'}));
  assert.throws(()=>prepareDshProfile(input),/lilith_memory_unadapted_package/);
  const speakDir=path.join(localModules,'dsh-speak-up');fs.mkdirSync(speakDir);
  const both=JSON.parse(fs.readFileSync(localManifestPath));both.dsh.profile.bundles.push('dsh-feiyu-mood','dsh-speak-up');fs.writeFileSync(localManifestPath,JSON.stringify(both));
  fs.writeFileSync(path.join(fishDir,'package.json'),JSON.stringify({version:'1.2.6-lilith.2',lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
  fs.writeFileSync(path.join(moodPackage,'package.json'),JSON.stringify({version:'0.7.0-lilith.3',lilithAdaptation:{adaptation:'lilith-sdk.1'}}));
  fs.writeFileSync(path.join(speakDir,'package.json'),JSON.stringify({version:'0.2.3'}));
  assert.throws(()=>prepareDshProfile(input),/lilith_speak_unadapted_package/);
  fs.writeFileSync(path.join(speakDir,'package.json'),JSON.stringify({version:'0.2.3-lilith.1',lilithAdaptation:{adaptation:'lilith-speak-sdk.1'}}));
  const speaking=prepareDshProfile(input);assert.equal(speaking.status.speak_up.installed,true);assert.match(fs.readFileSync(speaking.patchFile,'utf8'),/lilithSpeakUpReady/);
  fs.writeFileSync(path.join(fishDir,'package.json'),JSON.stringify({version:'1.2.6-lilith.1',lilithAdaptation:{adaptation:'lilith-memory-sdk.1'}}));
  assert.throws(()=>prepareDshProfile(input),/lilith_speak_source_adapters_required/);
  fs.writeFileSync(localManifestPath,JSON.stringify({...fish,dsh:{profile:{bundles:fish.dsh.profile.bundles.filter(x=>x!=='dsh-fish-memory')}}}));
  fs.writeFileSync(path.join(sdk, 'cordis.patch.yml'), '- id: secret\n  config:\n    apiKey: plain-fixture-secret\n');
  prepareDshProfile(input); // Future native edits do not replace an existing local user layer.
  assert.throws(() => prepareDshProfile({...input, home: path.join(root, 'unsafe-first-seed')}), /requires_review/);
  console.log('dsh-profile: native migration, persistent local plugins, isolated install root, secret-free credentials and mandatory guard overlay passed');
} finally { fs.rmSync(root, {recursive: true, force: true}); }
