// Lilith compatibility integration, not upstream's unrestricted runtime mode.
// We never import lib/index.js, apply its Cordis bundle, rewrite host files, or
// install retry/rewind/boost hooks. The upstream revision is trusted code; the
// read-only diagnostic child below is an extra precaution, not an OS sandbox.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';

export const name = 'lilith-purge-compatible';
export const inject = ['systemPrompt', 'lilithGuardReady'];
export const MODE = 'lilith-compatible-v1';
export const SOURCE_REPOSITORY = 'https://github.com/kingcharleslzy-ai/dsh-purge';
export const SOURCE_COMMIT = '5ba6fadac493b07669ab7379c3e6bda618f286a0';
export const SOURCE_VERSION = '1.6.55';
export const SECTION_NAME = 'lilith:purge-capability-help';
const HASH = value => createHash('sha256').update(value).digest('hex');
const includes = (root, file) => file === root || file.startsWith(root + path.sep);
const SNAPSHOT_SUBDIRECTORY = 'lilith-purge';
const LIMITATIONS = Object.freeze([
  '仅启用上游只读诊断与按任务选择能力的提示；不是上游完整破甲模式。',
  '不替换莉莉丝人设，不装载上游默认注入、boost、host patch 或确认旁路。',
  '不启用自动应用、更新、回滚、拒绝重试、续写、rewind、红队预设及管理 HTTP 接口。',
  '删除和高危操作仍须主人针对具体操作明文再次确认；既有暂停与工具范围保持有效。',
  '状态文件证明兼容模块装载；提示渲染次数证明组装调用，不单独证明模型实际接收。'
]);
const FEATURES = Object.freeze({readonly_diagnostics: true, capability_help: true,
  upstream_apply: false, host_patch: false, persona_replacement: false, boost: false,
  auto_apply: false, auto_update: false, auto_retry: false, auto_continue: false,
  rewind: false, redteam: false, management_http: false, approval_bypass: false});

function sourceFile(root, relative, maximum) {
  const file = path.join(root, relative), real = fs.realpathSync(file), info = fs.statSync(real);
  if (!includes(root, real) || !info.isFile() || info.size > maximum) throw new Error('lilith_purge_source_invalid');
  return {file: real, bytes: fs.readFileSync(real)};
}

export function inspectSource(input, expectedCommit = SOURCE_COMMIT) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || expectedCommit !== SOURCE_COMMIT)
    throw new Error('lilith_purge_source_pin_required');
  const root = fs.realpathSync(input);
  const manifestFile = sourceFile(root, 'package.json', 65536);
  const lockFile = sourceFile(root, 'lilith-source.json', 65536);
  let manifest, lock;
  try {manifest = JSON.parse(manifestFile.bytes); lock = JSON.parse(lockFile.bytes);} catch {throw new Error('lilith_purge_source_invalid');}
  if (manifest.name !== 'dsh-purge-community' || manifest.version !== SOURCE_VERSION ||
      lock.repository !== SOURCE_REPOSITORY || lock.commit !== expectedCommit || lock.version !== SOURCE_VERSION || lock.adaptation !== MODE ||
      lock.archive_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(lock.archive_sha256))
    throw new Error('lilith_purge_source_pin_mismatch');
  const core = sourceFile(root, 'lib/core.js', 2 * 1024 * 1024);
  const capability = sourceFile(root, 'lib/capability-protocol.js', 128 * 1024);
  if (!/export\s+async\s+function\s+gatherState\b/.test(core.bytes.toString('utf8')) ||
      !/export\s+function\s+capabilityProtocolText\b/.test(capability.bytes.toString('utf8')))
    throw new Error('lilith_purge_upstream_api_missing');
  return {root, capabilityFile: capability.file, source: {
    repository: SOURCE_REPOSITORY, commit: expectedCommit, version: SOURCE_VERSION,
    package_name: manifest.name, manifest_sha256: HASH(manifestFile.bytes),
    core_sha256: HASH(core.bytes), capability_sha256: HASH(capability.bytes),
    ...(lock.archive_sha256 ? {archive_sha256: lock.archive_sha256} : {})
  }};
}

// Executed only in a short-lived child with no inherited credentials. Writes,
// process launching and network operations are disabled before upstream imports.
// aiBase:'' prevents gatherState from choosing/patch-inspecting another host.
async function readonlyDiagnosticWorker() {
  const fsModule = await import('node:fs'), fs = fsModule.default;
  const {createRequire, syncBuiltinESMExports} = await import('node:module');
  const {pathToFileURL} = await import('node:url');
  const path = (await import('node:path')).default;
  const denied = () => {throw new Error('LILITH_PURGE_READONLY_DIAGNOSTIC');};
  const protect = target => {
    for (const method of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'unlink', 'rm', 'rmdir', 'truncate',
      'ftruncate', 'chmod', 'fchmod', 'lchmod', 'chown', 'fchown', 'lchown', 'utimes', 'futimes', 'lutimes',
      'copyFile', 'cp', 'link', 'symlink', 'write', 'writev', 'createWriteStream', 'watch', 'watchFile']) {
      for (const key of [method, method + 'Sync']) if (typeof target[key] === 'function') target[key] = denied;
    }
    if (typeof target.openSync === 'function') {
      const original = target.openSync;
      target.openSync = (file, flags, ...rest) => {
        if (typeof flags === 'string' ? flags !== 'r' && flags !== 'rs' : flags !== 0) return denied();
        return original.call(target, file, flags, ...rest);
      };
    }
    if (typeof target.open === 'function') {
      const original = target.open;
      target.open = (file, flags, ...rest) => {
        if (typeof flags === 'string' ? flags !== 'r' && flags !== 'rs' : flags !== 0) return denied();
        return original.call(target, file, flags, ...rest);
      };
    }
    if (target.promises) {
      const promises = target.promises;
      for (const key of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'unlink', 'rm', 'rmdir', 'truncate',
        'chmod', 'lchmod', 'chown', 'lchown', 'utimes', 'lutimes', 'copyFile', 'cp', 'link', 'symlink', 'watch'])
        if (typeof promises[key] === 'function') promises[key] = denied;
      if (typeof promises.open === 'function') {
        const original = promises.open;
        promises.open = (file, flags, ...rest) => {
          if (typeof flags === 'string' ? flags !== 'r' && flags !== 'rs' : flags !== 0) return denied();
          return original.call(promises, file, flags, ...rest);
        };
      }
    }
  };
  protect(fs);
  try {protect(createRequire(import.meta.url)('original-fs'));} catch {}
  const cp = (await import('node:child_process')).default;
  for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = denied;
  for (const moduleName of ['node:http', 'node:https', 'node:net', 'node:tls', 'node:dgram']) {
    const module = (await import(moduleName)).default;
    for (const key of ['request', 'get', 'connect', 'createConnection', 'createServer', 'createSocket'])
      if (typeof module[key] === 'function') module[key] = denied;
  }
  globalThis.fetch = denied;
  for (const key of ['log', 'info', 'warn', 'error', 'debug']) console[key] = () => {};
  syncBuiltinESMExports();
  const report = {ok: false, target_scope: 'isolated_home_no_host_target',
    host_patches_executed: false, subprocesses_allowed: false, network_allowed: false};
  try {
    const upstream = await import(pathToFileURL(path.join(process.env.LILITH_DSH_PURGE_ROOT, 'lib/core.js')).href);
    const raw = await upstream.gatherState({dshHome: process.env.DSH_HOME, aiBase: '', surface: 'web'});
    report.ok = true;
    report.upstream_api = 'core.gatherState';
    report.host_target_selected = Boolean(raw.ai_base);
    for (const key of ['patches_total', 'patches_applied', 'patches_pending', 'patches_na'])
      report[key] = Number.isSafeInteger(raw[key]) && raw[key] >= 0 ? raw[key] : null;
  } catch {report.error = 'LILITH_PURGE_DIAGNOSTIC_UNAVAILABLE';}
  process.stdout.write(JSON.stringify(report) + '\n', () => process.exit(0));
}

export function gatherReadOnlyDiagnostic({root, home, executable = process.execPath, timeoutMs = 10000}) {
  return new Promise(resolve => {
    const script = '(' + readonlyDiagnosticWorker.toString() + ')()';
    execFile(executable, ['--input-type=module', '-e', script], {cwd: home, timeout: timeoutMs, maxBuffer: 65536,
      env: {ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, HOME: home, PATH: '', DSH_SURFACE: 'web', LILITH_DSH_PURGE_ROOT: root}},
    (error, stdout) => {
      if (error) return resolve({ok: false, error: 'LILITH_PURGE_DIAGNOSTIC_PROCESS_FAILED'});
      try {
        const parsed = JSON.parse(String(stdout).trim());
        if (!parsed || typeof parsed.ok !== 'boolean') throw new Error();
        resolve(parsed);
      } catch {resolve({ok: false, error: 'LILITH_PURGE_DIAGNOSTIC_INVALID_RESULT'});}
    });
  });
}

function stateWriter(home) {
  const directory = path.join(home, SNAPSHOT_SUBDIRECTORY), file = path.join(directory, 'status.json');
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  if (fs.realpathSync(directory) !== directory) throw new Error('lilith_purge_state_symlink_refused');
  return state => {
    try {
      const existing = fs.lstatSync(file);
      if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error('lilith_purge_state_invalid');
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
    const temporary = path.join(directory, '.status-' + randomUUID() + '.tmp');
    fs.writeFileSync(temporary, JSON.stringify(state), {flag: 'wx', mode: 0o600});
    fs.renameSync(temporary, file);
  };
}

export async function installPurgeCompatibility(ctx, options = {}) {
  const guard = ctx.get?.('lilithGuardReady') ?? ctx.lilithGuardReady;
  if (!guard?.ready || guard.all_tools_use_host_gate !== true || typeof ctx.systemPrompt?.section !== 'function')
    throw new Error('lilith_purge_guard_required');
  const inputHome = options.home ?? process.env.DSH_HOME;
  if (typeof inputHome !== 'string' || !path.isAbsolute(inputHome)) throw new Error('lilith_purge_isolated_home_required');
  const home = fs.realpathSync(inputHome), userHome = path.resolve(options.userHome ?? os.homedir());
  if (home === path.parse(home).root || home === userHome || includes(path.join(userHome, '.dsh'), home))
    throw new Error('lilith_purge_isolated_home_required');
  const inspected = inspectSource(options.root ?? process.env.LILITH_DSH_PURGE_ROOT,
    options.commit ?? process.env.LILITH_DSH_PURGE_COMMIT ?? SOURCE_COMMIT);
  // This upstream module is a pure string-producing capability helper. It has
  // no imports and does not install identity, maintenance, or tool hooks.
  const capability = await import(pathToFileURL(inspected.capabilityFile).href);
  const protocol = capability.capabilityProtocolText({enabled: true, redteam: false, redteamChild: false});
  if (typeof protocol !== 'string' || !protocol.trim() || Buffer.byteLength(protocol) > 16384)
    throw new Error('lilith_purge_capability_invalid');
  const prompt = [
    '当前启用 dsh-purge 的莉莉丝兼容模式：只读诊断与按任务选用能力提示，不是上游完整破甲模式。',
    '莉莉丝既定人设、主人的指令与当前会话工具权限始终保留。目录中的能力不等于已获使用许可。',
    '删除文件及高危操作必须获得主人对具体操作的明文再次确认；不得绕过拒绝、暂停或审批，也不得自动重试已拒绝的操作。',
    '只使用当前会话实际提供且已获允许的技能、MCP 与工具；群聊和辅助分类不得借本段扩大权限。',
    protocol
  ].join('\n\n');
  const write = stateWriter(home);
  const state = {schema_version: 1, loaded: false, mode: MODE, label: 'Lilith 兼容模式：只读诊断与能力提示',
    instance_id: randomUUID(), pid: process.pid, loaded_at: new Date().toISOString(),
    source: inspected.source, features: FEATURES, limitations: LIMITATIONS,
    guard_required: true, prompt_render_count: 0, prompt_sha256: HASH(prompt),
    diagnostic: await gatherReadOnlyDiagnostic({root: inspected.root, home, executable: options.executable, timeoutMs: options.timeoutMs})};
  let lastWrite = 0;
  ctx.systemPrompt.section({name: SECTION_NAME, order: 3200, interpolate: false, text: () => {
    state.prompt_render_count++;
    // A local assembly receipt, without transcript, model output or secrets.
    if (state.prompt_render_count === 1 || Date.now() - lastWrite > 1000) {
      try {write(state); lastWrite = Date.now();} catch {state.status_write_error = 'LILITH_PURGE_STATUS_WRITE_FAILED';}
    }
    return prompt;
  }});
  state.loaded = true; write(state);
  const service = Object.freeze({ready: true, mode: MODE, status: () => JSON.parse(JSON.stringify(state))});
  ctx.provide('lilithPurgeReady', service);
  return service;
}

export async function apply(ctx) {await installPurgeCompatibility(ctx);}
