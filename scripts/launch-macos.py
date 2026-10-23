#!/usr/bin/env python3
"""Launch this workspace's isolated macOS development copy; never patch the Steam install."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
PROBE = Path(os.environ.get('LILITH_PROBE_DIR', ROOT.parent / 'macos-probe')).expanduser().resolve()
GAME = Path(os.environ.get('LILITH_GAME_DIR', PROBE / 'game')).expanduser().resolve()
EXECUTABLE = GAME / 'Lilith.app/Contents/MacOS/Lilith'
DATA = Path(os.environ.get('LILITH_AI_DATA_DIR', PROBE / 'user-data/mod/LilithAI')).expanduser().resolve()


def node_path():
    candidates = [os.environ.get('LILITH_NODE_PATH'), shutil.which('node'),
                  str(Path.home() / '.nvm/versions/node/v24.18.0/bin/node')]
    for candidate in filter(None, candidates):
        try:
            version = subprocess.check_output([candidate, '--version'], text=True).strip()
            if version.startswith('v24.'):
                return candidate
        except (OSError, subprocess.CalledProcessError):
            pass
    raise SystemExit('需要 Node.js 24；请设置 LILITH_NODE_PATH 为本机 node 的完整路径。')


def main():
    if 'steamapps/common' in GAME.as_posix().lower():
        raise SystemExit('请使用 Steam 安装目录之外的独立游戏副本。')
    if not EXECUTABLE.is_file() or not (GAME / 'BepInEx/plugins/LilithMod.dll').is_file():
        raise SystemExit('缺少隔离游戏或 Mod 构建产物；请参阅 docs/macos-preview.md。')
    DATA.mkdir(parents=True, exist_ok=True)
    lock = (DATA / '.launch.lock').open('w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('开发版启动器已在运行。')
    processes = subprocess.check_output(['ps', '-axo', 'pid=,command='], text=True)
    if any(line.strip().split(None, 1)[-1].startswith(str(EXECUTABLE)) for line in processes.splitlines()):
        raise SystemExit('隔离游戏已经运行。')
    home = PROBE / 'user-data/home'
    (home / 'Library/Application Support').mkdir(parents=True, exist_ok=True)
    logs = PROBE / 'logs' / (time.strftime('%Y%m%d-%H%M%S') + '-interactive')
    logs.mkdir(parents=True)
    real_library = str(Path.home() / 'Library')
    profile = logs / 'isolation.sb'
    profile.write_text('(version 1)\n(allow default)\n(deny file-write* (subpath '
                       + json.dumps(real_library) + '))\n')
    env = dict(os.environ, HOME=str(home), CFFIXED_USER_HOME=str(home),
               XDG_CONFIG_HOME=str(home / '.config'), SteamAppId='4643090', SteamGameId='4643090',
               LILITH_PROBE_MAIN_QUEUE='1', LILITH_PROBE_FOLLOW_THUNK='0',
               LILITH_DISABLE_UPDATE_CHECK='1', LILITH_AI_DATA_DIR=str(DATA),
               LILITH_NODE_PATH=node_path(), BEPINEX_PRELOADER_LOG=str(logs / 'preloader.log'),
               BEPINEX_FAIL_FAST='1')
    env.pop('LILITH_MAC_SELFTEST', None)
    command = ['/usr/bin/sandbox-exec', '-f', str(profile), '/bin/bash', str(GAME / 'run_bepinex.sh'),
               str(EXECUTABLE), '-logFile', str(logs / 'Player.log')]
    print('启动 macOS Mod 开发版（独立副本）\nF8 / Fn+F8：聊天；聊天窗口“设置”：模型与记忆\n日志：' + str(logs), flush=True)
    with (logs / 'stdout.log').open('w') as output:
        child = subprocess.Popen(command, cwd=GAME, env=env, stdout=output,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        def stop(_signum, _frame):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        code = child.wait()
    loader_log = GAME / 'BepInEx/LogOutput.log'
    if loader_log.exists():
        shutil.copy2(loader_log, logs / 'LogOutput.log')
    (logs / 'summary.json').write_text(json.dumps({ 'pid': child.pid, 'exit_code': code,
        'data_root': str(DATA), 'self_test': False, 'steam_install_modified_by_launcher': False }, indent=2))
    print(f'开发版已退出：{code}', flush=True)
    raise SystemExit(0 if code in [0, 143, -15] else code)


if __name__ == '__main__':
    main()
