'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// This is deliberately a narrow carrier, not a YAML interpreter. In particular,
// desktop UI plugins and executable YAML never enter the isolated SDK profile.
const TRUSTED = new Map([
  ['@deepseek-ai/dsh-agent-default-model', 'agent-default-model'],
  ['@deepseek-ai/dsh-llm-pi-ai', 'llm-pi-ai'],
  ['@deepseek-ai/dsh-llm-deepseek-api-key', 'llm-deepseek'],
  ['@deepseek-ai/dsh-llm-deepseek-account', 'llm-deepseek-account'],
  ['@deepseek-ai/dsh-mcp-client', 'mcp']
]);
const SECRET_FIELD = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|token)$/i;
const QUOTE = value => JSON.stringify(value);
function fail(code) { throw new Error(code); }
function scalar(value) {
  const s = value.trim();
  if (s.startsWith('"')) { try { const v = JSON.parse(s); return typeof v === 'string' ? v : undefined; } catch { return undefined; } }
  if (s.startsWith("'")) return /^'(?:[^']|'')*'$/.test(s) ? s.slice(1, -1).replace(/''/g, "'") : undefined;
  return /^[\w./:@+ -]+$/.test(s) ? s.replace(/\s+#.*$/, '').trim() : undefined;
}
function pluginRows(text) {
  if (Buffer.byteLength(text) > 1024 * 1024) fail('dsh_profile_patch_too_large');
  const lines = text.split(/\r?\n/), rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s+(?:name:\s*([^\n]+)|id:\s*([^\n]+))/);
    if (!m) continue;
    const indent = m[1].length;
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].trimStart().startsWith('#') || lines[end].search(/\S/) > indent)) end++;
    const block = lines.slice(i, end);
    const nameLine = m[2] || block.slice(1).map(l => l.match(/^\s+name:\s*(.*)$/)?.[1]).find(Boolean);
    const id = m[3] && scalar(m[3]);
    const name = nameLine ? scalar(nameLine) : [...TRUSTED].find(([, value]) => value === id && value !== 'mcp')?.[0];
    if (name && TRUSTED.has(name)) {
      const start = block.findIndex(l => /^\s+config:\s*(?:#.*)?$/.test(l));
      const config = start < 0 ? [] : block.slice(start + 1).filter(l => !/^\s*$|^\s*#/.test(l));
      const normalized = config.map(l => l.slice(Math.min(l.length, indent + 4)));
      rows.push({ name, id: TRUSTED.get(name), sourceId: id, config: normalized });
    }
  }
  return rows;
}
function safeConfig(lines) {
  const text = lines.join('\n');
  // No execution tags, anchors, secret-bearing fields, credential URL userinfo,
  // or key/token-like literal arguments. apiKeyEnv is only a reference name.
  if (/(?:!!|!<|!include|(?:^|\s)[&*][\w-]+|\$\{|`)/m.test(text)) return false;
  if (/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|https?:\/\/[^\s/]+@)/i.test(text)) return false;
  for (const line of lines) {
    const field = line.match(/^\s*([^\s:#][^:]*):/);
    if (field && SECRET_FIELD.test(field[1].trim().replace(/^['"]|['"]$/g, ''))) return false;
    if (/--(?:api[-_]?key|token|password|secret)(?:[=\s]|$)/i.test(line)) return false;
    if (/^\s*(?:[A-Z_]*(?:KEY|TOKEN|PASSWORD|SECRET)[A-Z_]*)\s*:/.test(line)) return false;
  }
  return true;
}
function readOptional(io, file, fallback = '') {
  try { return io.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function writeOwned(io, file, value) {
  io.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
  io.writeFileSync(file, value, {encoding: 'utf8', mode: 0o600});
}
function renderTrustedRows(rows) {
  let patch = '';
  rows.forEach((row, index) => {
    if (row.id === 'mcp') {
      patch += '- insert:\n    - id: lilith-native-mcp-' + index + '\n      name: ' + QUOTE(row.name) + '\n';
      if (row.config.length) patch += '      config:\n' + row.config.map(l => '        ' + l).join('\n') + '\n';
    } else {
      patch += '- id: ' + row.id + '\n';
      if (row.config.length) patch += '  config:\n' + row.config.map(l => '    ' + l).join('\n') + '\n';
    }
  });
  return patch;
}
const listBody = text => text.split(/\r?\n/).filter(l => !/^\s*\[\]\s*(?:#.*)?$/.test(l)).join('\n').trim() + '\n';
function seedModuleLinks(io, sourceModules, modules, manifest) {
  // A writable node_modules root must belong to Lilith. Linking that entire
  // directory would make a later `dsh plugin add` mutate the native SDK profile.
  if (io.existsSync(modules) && io.lstatSync(modules).isSymbolicLink()) {
    if (io.realpathSync(modules) !== io.realpathSync(sourceModules)) fail('dsh_profile_modules_conflict');
    io.unlinkSync(modules); // Only retire the old Lilith-owned directory link.
  }
  io.mkdirSync(modules, {recursive: true, mode: 0o700});
  const names = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(key => Object.keys(manifest[key] || {})));
  for (const name of names) {
    if (!/^(?:@[\w.-]+\/)?[\w.-]+$/.test(name)) fail('dsh_profile_dependency_name_invalid');
    const source = path.join(sourceModules, name), target = path.join(modules, name);
    if (!io.existsSync(source) || io.existsSync(target)) continue;
    io.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
    io.symlinkSync(source, target, 'dir');
  }
}
/**
 * Prepare only Lilith-owned files. The DSH credential document is referenced by
 * path and never opened, copied, printed, or converted into an environment key.
 * fsImpl/osHome support isolated fixture tests without touching the real user.
 */
function prepareDshProfile({home, workspace, sourceHome, guardPlugin, guardEndpoint, guardToken, persona, searchPlugin, auxiliary = false, chatOnly = false,
  fsImpl = fs, osHome = os.homedir(), profile = 'lilith'} = {}) {
  const io = fsImpl;
  for (const value of [home, workspace, guardPlugin]) if (typeof value !== 'string' || !path.isAbsolute(value)) fail('dsh_profile_absolute_path_required');
  home = path.resolve(home); workspace = path.resolve(workspace); sourceHome = path.resolve(sourceHome || path.join(osHome, '.dsh'));
  if (home === sourceHome || home.startsWith(sourceHome + path.sep) || home === osHome || home === path.parse(home).root) fail('dsh_profile_home_must_be_isolated');
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(profile) || profile === 'desktop') fail('dsh_profile_invalid_name');
  let endpoint; try { endpoint = new URL(guardEndpoint); } catch { fail('dsh_guard_endpoint_required'); }
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password) fail('dsh_guard_loopback_required');
  if (typeof guardToken !== 'string' || guardToken.length < 16 || /[\r\n\0]/.test(guardToken)) fail('dsh_guard_token_required');
  if (!io.existsSync(guardPlugin)) fail('dsh_guard_plugin_missing');
  const nativeSdk = path.join(sourceHome, 'profiles', 'sdk');
  const profileDir = path.join(home, 'profiles', profile), manifestPath = path.join(profileDir, 'package.json');
  const localPatchPath = path.join(profileDir, 'cordis.patch.yml'), markerPath = path.join(profileDir, '.lilith-native-seed.json');
  const seeded = io.existsSync(markerPath), localManifestExists = io.existsSync(manifestPath);
  let manifest;
  try { manifest = JSON.parse(io.readFileSync(localManifestExists ? manifestPath : path.join(nativeSdk, 'package.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') fail('dsh_native_sdk_manifest_invalid'); }
  manifest ||= {name: 'lilith-dsh-profile', private: true, dependencies: {}, dsh: {profile: {bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app']}}};
  const bundles = manifest.dsh?.profile?.bundles;
  if (!Array.isArray(bundles) || !bundles.every(v => typeof v === 'string') || !bundles.includes('@deepseek-ai/dsh-sdk-app')) fail('dsh_native_sdk_bundle_required');
  const sdkPatch = readOptional(io, path.join(nativeSdk, 'cordis.patch.yml'), '[]\n');
  if (!seeded && !io.existsSync(localPatchPath) && !safeConfig(sdkPatch.split(/\r?\n/).filter(l=>!l.trimStart().startsWith('#')))) fail('dsh_native_sdk_patch_requires_review');
  const desktopPatch = readOptional(io, path.join(sourceHome, 'profiles', 'desktop', 'cordis.patch.yml'));
  const isRea = r => r.id === 'mcp' && /(?:serverName:\s*['"]?rea\b|[\\/]rea(?:[\\/]|\b)|rea-agents|rea\.mjs)/i.test(r.config.join('\n'));
  const rows = pluginRows(desktopPatch), trusted = rows.filter(r => safeConfig(r.config) && !isRea(r) && (!(auxiliary||chatOnly) || r.id !== 'mcp'));
  const localPatchExists = io.existsSync(localPatchPath), existingLocalPatch = readOptional(io, localPatchPath);
  // Native defaults seed the independent user layer once. Existing local edits
  // follow those defaults and retain precedence; later prepares never rewrite it.
  const userPatch = seeded ? existingLocalPatch : localPatchExists
    ? renderTrustedRows(trusted) + listBody(existingLocalPatch)
    : listBody(sdkPatch) + renderTrustedRows(trusted);
  // Installed DSH 0.2.1-rc.2's dsh-llm-deepseek DEFAULT_MODELS starts with
  // deepseek-flash. A provider identifier is never used as a model identifier.
  let provider = 'deepseek-official', model = 'deepseek-flash', reasoningEffort, nativeModelSelected = false;
  for (const row of pluginRows(userPatch).filter(r => r.id === 'agent-default-model' && safeConfig(r.config))) {
    for (const line of row.config) {
      const m = line.match(/^(provider|model|reasoningEffort):\s*(.*?)\s*$/);
      const value = m && scalar(m[2]);
      if (!value || value.length > 200) continue;
      if (m[1] === 'provider') provider = value;
      else if (m[1] === 'model') { model = value; nativeModelSelected = true; }
      else reasoningEffort = value;
    }
  }
  io.mkdirSync(workspace, {recursive: true, mode: 0o700});
  io.mkdirSync(profileDir, {recursive: true, mode: 0o700});
  // Preserve native SDK bundle and dependency declarations; installed third-party
  // package bytes remain in the original profile and are shared through a link.
  const profileManifest = {name: 'lilith-dsh-profile', private: true,
    dsh: {profile: {bundles: [...bundles]}}};
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
    if (manifest[key]) profileManifest[key] = manifest[key];
  if (!localManifestExists) writeOwned(io, manifestPath, JSON.stringify(profileManifest, null, 2) + '\n');
  if (!seeded || !localPatchExists) writeOwned(io, localPatchPath, userPatch.trim() ? userPatch : '[]\n');
  const sourceModules = path.join(nativeSdk, 'node_modules'), modules = path.join(profileDir, 'node_modules');
  seedModuleLinks(io, sourceModules, modules, manifest);
  const purgeFile=path.join(profileDir,'node_modules','dsh-purge-community','package.json');
  let purge=null;
  if(bundles.includes('dsh-purge-community')){
    try{purge=JSON.parse(io.readFileSync(purgeFile,'utf8'));}catch{fail('lilith_purge_package_missing');}
    if(purge.lilithAdaptation?.adaptation!=='lilith-compat.1')fail('lilith_purge_unadapted_package');
  }
  const credentialPath = path.join(sourceHome, '.credentials.yaml');
  let mood=null;
  if(bundles.includes('dsh-feiyu-mood')){
    try{mood=JSON.parse(io.readFileSync(path.join(modules,'dsh-feiyu-mood/package.json'),'utf8'));}catch{fail('lilith_mood_package_missing');}
    if(mood.lilithAdaptation?.adaptation!=='lilith-sdk.1')fail('lilith_mood_unadapted_package');
  }
  let memory=null;
  if(bundles.includes('dsh-fish-memory')){
    try{memory=JSON.parse(io.readFileSync(path.join(modules,'dsh-fish-memory/package.json'),'utf8'));}catch{fail('lilith_memory_package_missing');}
    if(memory.lilithAdaptation?.adaptation!=='lilith-memory-sdk.1')fail('lilith_memory_unadapted_package');
  }
  let speak=null;
  if(bundles.includes('dsh-speak-up')){
    try{speak=JSON.parse(io.readFileSync(path.join(modules,'dsh-speak-up/package.json'),'utf8'));}catch{fail('lilith_speak_package_missing');}
    if(speak.lilithAdaptation?.adaptation!=='lilith-speak-sdk.1')fail('lilith_speak_unadapted_package');
    if(!memory||!(memory.version==='1.2.6-lilith.2'||memory.lilithAdaptation.proactiveOrigin===1)||!mood||!(mood.version==='0.7.0-lilith.3'||mood.lilithAdaptation.proactiveOrigin===1))fail('lilith_speak_source_adapters_required');
  }
  let bili=null;
  if(bundles.includes('dsh-bili-subagent')){
    try{bili=JSON.parse(io.readFileSync(path.join(modules,'dsh-bili-subagent/package.json'),'utf8'));}catch{fail('lilith_bili_package_missing');}
    if(bili.lilithAdaptation?.adaptation!=='lilith-bili-readonly-sdk.1')fail('lilith_bili_unadapted_package');
  }
  let patch = '# Generated Lilith-only SDK overlay. No credential values are stored here.\n';
  patch += '- id: credentials\n  disabled: false\n  name: "@deepseek-ai/dsh-credentials-local"\n  config:\n    path: ' + QUOTE(credentialPath) + '\n    watch: true\n';
  patch += '- id: sandbox-policy\n  disabled: false\n  config:\n    mode: danger-full-access\n    workspaceRoot: ' + QUOTE(workspace) + '\n';
  patch += '- id: approval\n  disabled: false\n  name: "@deepseek-ai/dsh-user-approval"\n  config:\n    policy: ask\n';
  patch += '- id: permission\n  disabled: false\n  config:\n    defaultPreset: lilith-full-access\n    presets:\n      lilith-full-access:\n        sandbox: danger-full-access\n        approval: ask\n        name: Lilith full access with explicit safety confirmation\n';
  patch += '- id: system-prompt\n  disabled: false\n  config:\n    includeHarnessIdentity: false\n    personaSuffix: \"\"\n    personaPrefix: ' + QUOTE(String(persona || '你是莉莉丝。保持既定角色人格；所有删除文件及高危操作必须取得主人针对具体操作的再次明确确认。')) + '\n';
  patch += '- insert:\n    - id: lilith-safety-guard\n      name: ' + QUOTE(guardPlugin) + '\n';
  patch += '- id: lilith-safety-guard\n  disabled: false\n  name: ' + QUOTE(guardPlugin) + '\n';
  patch += '- id: tools\n  disabled: false\n';
  // Execution denial alone does not remove tool schemas or stop an MCP child.
  // Disable REA at the loader, including an already seeded user layer. Never
  // rewrite the ordinary desktop profile or its MCP processes.
  const disabledMcp = pluginRows(userPatch).filter(r => r.id === 'mcp' && (auxiliary || chatOnly || isRea(r)));
  for (const row of disabledMcp) {
    if (!row.sourceId || !/^[\w.-]+$/.test(row.sourceId)) fail('dsh_mcp_disable_id_required');
    patch += '- id: ' + row.sourceId + '\n  disabled: true\n';
  }
  if (auxiliary || chatOnly) {
    const disabled = ['tool-plugin-manager','tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search','tool-working-directory','tool-web','tool-skill','skill-filesystem','tool-subagent','tool-subagent-fork','tool-subagent-control','tool-subagent-list-agents','tool-workflow','tool-todo','tool-goal','agent-instructions','plan-mode','workspace-dependencies','skill-office','session-title-llm','session-telemetry-otel'];
    patch += disabled.map(id => '- id: ' + id + '\n  disabled: true\n').join('');
  }
  if(searchPlugin){
    if(!path.isAbsolute(searchPlugin)||!io.existsSync(searchPlugin))fail('lilith_search_plugin_missing');
    patch += '- insert:\n    - id: lilith-native-search\n      name: '+QUOTE(searchPlugin)+'\n';
    patch += '- id: tool-web\n  disabled: true\n'; // Search is host-mediated and budgeted, never a model tool bypass.
  }
  if(purge)patch += '- id: dsh-purge\n  disabled: '+(chatOnly?'true':'false')+'\n';
  patch += '- id: sdk-jsonrpc-server\n  disabled: false\n  name: "@deepseek-ai/dsh-sdk-jsonrpc-server"\n  inject: [sdkAppStartup, loader, lilithGuardReady'+(searchPlugin?', lilithSearchReady':'')+(purge&&!chatOnly?', lilithPurgeReady':'')+(mood?', lilithMoodReady':'')+(memory?', lilithMemoryReady':'')+(speak?', lilithSpeakUpReady':'')+(bili?', lilithBiliReady':'')+']\n';
  const patchFile = path.join(home, 'lilith.patch.yml');
  writeOwned(io, patchFile, patch);
  if (!seeded) writeOwned(io, markerPath, '{"version":1}\n');
  const agentsHome = path.join(home, 'agents'); io.mkdirSync(agentsHome, {recursive: true, mode: 0o700});
  const authConfigured = io.existsSync(credentialPath) && io.statSync(credentialPath).isFile();
  const searchRef=pluginRows(userPatch).filter(r=>r.id==='llm-deepseek').flatMap(r=>r.config).map(l=>l.match(/^apiKeyEnv:\s*(.*?)\s*$/)?.[1]).filter(Boolean).map(scalar).filter(v=>/^[A-Z][A-Z0-9_]{0,99}$/.test(v)).at(-1)||'DEEPSEEK_API_KEY';
  return {profile, patchFile, provider, model, searchRef, ...(reasoningEffort ? {reasoningEffort} : {}),
    env: {DSH_HOME: home, DSH_AGENTS_HOME: agentsHome, DSH_PERMISSION_MODE: 'danger-full-access',
      LILITH_DSH_GUARD_URL: endpoint.href, LILITH_DSH_GUARD_TOKEN: guardToken},
    status: {auth_configured: authConfigured, auth_verified: false, native_sdk_present: io.existsSync(path.join(nativeSdk, 'package.json')),
      native_dependency_count: Object.keys(manifest.dependencies || {}).length, bundle_count: bundles.length, native_model_selected: nativeModelSelected,
      migrated_plugin_count: trusted.length, mcp_count: pluginRows(userPatch).filter(r=>r.id==='mcp'&&!isRea(r)&&!auxiliary&&!chatOnly).length,
      chat_only:chatOnly, tools_disabled:auxiliary||chatOnly, rea_disabled: true, rea_disabled_instances: disabledMcp.filter(isRea).length, auxiliary_profile: auxiliary,
      skipped_plugin_count: rows.length - trusted.length, local_profile_preserved: localManifestExists,
      purge:purge?{installed:true,enabled:!chatOnly,status:chatOnly?'disabled_chat_only':'pending',version:purge.version,adaptation:purge.lilithAdaptation.adaptation,readiness_required:true,host_patches_applied:false}:{installed:false},
      mood:mood?{installed:true,version:mood.version,adaptation:mood.lilithAdaptation.adaptation,readiness_required:true}:{installed:false},
      memory:memory?{installed:true,version:memory.version,adaptation:memory.lilithAdaptation.adaptation,readiness_required:true}:{installed:false},
      speak_up:speak?{installed:true,version:speak.version,adaptation:speak.lilithAdaptation.adaptation,readiness_required:true}:{installed:false},
      bili:bili?{installed:true,version:bili.version,adaptation:bili.lilithAdaptation.adaptation,read_only:true,readiness_required:true}:{installed:false},
      independent_node_modules: true, isolated_home: true, guard_required: true}};
}
module.exports = {prepareDshProfile, pluginRows, safeConfig};
