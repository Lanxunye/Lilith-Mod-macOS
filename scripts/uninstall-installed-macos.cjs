'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
try {
  const game = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'installation.json'), 'utf8'));
  if (fs.realpathSync(manifest.game_dir) !== fs.realpathSync(game)) throw new Error('安装目录不匹配，拒绝操作。');
  if (execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }).split('\n')
    .some(line => /\/Lilith\.app\/Contents\/MacOS\/Lilith\s*$/u.test(line)))
    throw new Error('请先退出正在运行的莉莉丝，再停用 Mod。');
  const allowed = new Set(['BepInEx','dotnet','libdoorstop.dylib','run_bepinex.sh','.doorstop_version',
    'Data','GameAssembly.dylib','启动莉莉丝Mod.command','停用莉莉丝Mod.command','莉莉丝常驻服务.command','LilithMod']);
  if (!Array.isArray(manifest.installed_entries) || manifest.installed_entries.some(n => !allowed.has(n)))
    throw new Error('安装清单异常，拒绝操作。');
  const runtimePath=path.join(os.homedir(),'Library/Application Support/LilithAI/runtime.json');
  if(fs.existsSync(runtimePath)){
    const runtime=JSON.parse(fs.readFileSync(runtimePath,'utf8'));
    if(runtime.lifecycle==='standalone' && Number.isSafeInteger(runtime.pid) && runtime.pid>0){
      let alive=false;try{process.kill(runtime.pid,0);alive=true;}catch{}
      if(alive)throw new Error('请先通过常驻服务入口 stop 停止 QQ 服务，再停用 Mod。');
    }
  }
  const backup = path.join(os.homedir(), 'Library/Application Support/LilithModBackups',
    'disabled-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
  // Move rather than delete; user data and newly created progress are retained.
  for (const name of manifest.installed_entries) {
    const source = path.join(game, name);
    if (fs.lstatSync(source, { throwIfNoEntry: false })) fs.renameSync(source, path.join(backup, name));
  }
  console.log('Mod 已停用，附加文件已移到：' + backup);
  console.log('游戏本体、原存档和 LilithAI 设置/聊天均保留。若设置过 Steam 启动选项，请清空后启动原版。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
