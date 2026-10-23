'use strict';

// Installed next to the official game; does not depend on the development workspace.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const game = path.resolve(__dirname, '..');
const executable = path.join(game, 'Lilith.app/Contents/MacOS/Lilith');
const data = path.join(os.homedir(), 'Library/Application Support/LilithAI');
const node = path.join(__dirname, 'runtime/node/bin/node');

function runningGame() {
  return execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' })
    .split('\n').some(line => /\/Lilith\.app\/Contents\/MacOS\/Lilith\s*$/u.test(line));
}

function preflight() {
  if (process.platform !== 'darwin' || !process.versions.node.startsWith('24.'))
    throw new Error('需要 macOS 和随附的 Node 24。');
  for (const name of ['Lilith.app/Contents/MacOS/Lilith', 'run_bepinex.sh', 'libdoorstop.dylib',
    'dotnet/libcoreclr.dylib', 'BepInEx/core/BepInEx.Unity.IL2CPP.dll',
    'BepInEx/core/LilithLoaderCompat.dll', 'BepInEx/core/liblilith_probe_dispatch.dylib',
    'BepInEx/plugins/LilithMod.dll', 'BepInEx/plugins/liblilith_macos.dylib',
    'BepInEx/plugins/companion/src/server.js']) {
    if (!fs.statSync(path.join(game, name)).isFile()) throw new Error('缺少安装文件：' + name);
  }
  if (fs.existsSync(path.join(data, 'config.json'))) JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8'));
  if (execFileSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true']).length) throw new Error('Rosetta 检查失败。');
}

async function reusableService(root, config) {
  try {
    const r=JSON.parse(fs.readFileSync(path.join(root,'runtime.json'),'utf8'));
    if(r.lifecycle!=='standalone'||!Number.isSafeInteger(r.pid)||r.pid<=0
      ||!['127.0.0.1','::1'].includes(r.host)||r.port!==(Number(config.listen_port)||6186)||!r.token)return false;
    process.kill(r.pid,0);
    const response=await fetch(`http://${r.host==='::1'?'[::1]':r.host}:${r.port}/v1/qq`,{
      headers:{Authorization:'Bearer '+r.token},signal:AbortSignal.timeout(2000)});
    return response.ok;
  }catch{return false;}
}

async function main() {
  preflight();
  if (process.argv.includes('--check')) {
    console.log('正式游戏 Mod 启动依赖检查通过。');
    return;
  }
  if (runningGame()) throw new Error('莉莉丝已在运行，请先从游戏菜单退出，避免重复启动。');
  if (!execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' })
    .split('\n').some(line => line.trim().endsWith('/steam_osx')))
    throw new Error('请先启动并登录 Steam，再双击 Mod 启动入口。');
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  const lock = path.join(data, '.official-launch.lock');
  if (fs.existsSync(lock)) {
    const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error('启动锁格式异常，请检查数据目录。');
    try { process.kill(previous.pid, 0); throw new Error('Mod 启动器已在运行。'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    fs.unlinkSync(lock);
  }
  const handle = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid })); fs.closeSync(handle);
  const cleanup = () => {
    try {
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).pid === process.pid) fs.unlinkSync(lock);
    } catch { /* Another launcher must never be unlocked. */ }
  };
  process.once('exit', cleanup);
  // Fail before opening the game if a different service owns the Companion port.
  const config = fs.existsSync(path.join(data, 'config.json'))
    ? JSON.parse(fs.readFileSync(path.join(data, 'config.json'), 'utf8')) : {};
  const reuse=await reusableService(data,config);
  if(!reuse)await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error('Mod 服务端口被占用，请先退出旧版 Mod。')));
    probe.listen(Number(config.listen_port) || 6186, config.listen_host || '127.0.0.1', () => probe.close(resolve));
  });
  if(reuse)console.log('已连接独立常驻服务；退出游戏不会停止 QQ。');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logs = path.join(data, 'logs', stamp);
  fs.mkdirSync(logs, { recursive: true, mode: 0o700 });
  const output = fs.openSync(path.join(logs, 'stdout.log'), 'a', 0o600);
  const env = { ...process.env,
    SteamAppId: '4643090', SteamGameId: '4643090',
    LILITH_PROBE_MAIN_QUEUE: '1', LILITH_PROBE_FOLLOW_THUNK: '0',
    LILITH_DISABLE_UPDATE_CHECK: '1', LILITH_AI_DATA_DIR: data, LILITH_NODE_PATH: node,
    BEPINEX_PRELOADER_LOG: path.join(logs, 'preloader.log'), BEPINEX_FAIL_FAST: '1' };
  delete env.LILITH_MAC_SELFTEST;
  delete env.LILITH_MAC_UI_DIAGNOSTICS;
  // Use the player's real game preferences and save directory, not the test HOME.
  env.HOME = os.homedir(); delete env.CFFIXED_USER_HOME; delete env.XDG_CONFIG_HOME;
  let args = process.argv.slice(2);
  if (args[0] && [executable, path.join(game, 'Lilith.app')].includes(path.resolve(args[0]))) args = args.slice(1);
  const child = spawn('/bin/bash', [path.join(game, 'run_bepinex.sh'), executable, ...args,
    '-logFile', path.join(logs, 'Player.log')], {
    cwd: game, env, stdio: ['ignore', output, output], detached: true,
  });
  fs.closeSync(output);
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ } };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  child.once('error', error => { console.error('启动失败：' + error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    // A native crash cannot run the plugin's shutdown handler. Stop any owned
    // Companion still in this game's process group so the next launch can bind.
    stop();
    fs.writeFileSync(path.join(logs, 'launch-summary.json'), JSON.stringify({
      pid: child.pid, exit_code: code, signal, official_game: true, app_bundle_modified: false,
    }, null, 2));
    cleanup();
    const failedSignal = signal && !['SIGTERM', 'SIGINT'].includes(signal);
    console.log(failedSignal ? '莉莉丝异常退出：' + signal + '。请查看本次日志。' : '莉莉丝已退出。');
    process.exitCode = failedSignal ? 128 + (os.constants.signals[signal] || 1) : (code && code !== 143 ? code : 0);
  });
  console.log('已启动 Steam 正式游戏 + Lilith Mod。\nF8 / Fn+F8 打开聊天；聊天里的“设置”打开配置页。');
  console.log('请保留此窗口，退出游戏后会自动结束；Ctrl+C 可停止本次启动。\n日志：' + logs);
}

if(require.main===module)main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports={reusableService};
