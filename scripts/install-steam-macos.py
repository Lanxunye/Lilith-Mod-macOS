#!/usr/bin/env python3
"""Local, backed-up sidecar installation into a user's official game. Never uploads anything."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
ENTRIES = ['BepInEx', 'dotnet', 'libdoorstop.dylib', 'run_bepinex.sh', '.doorstop_version',
           'Data', 'GameAssembly.dylib', '启动莉莉丝Mod.command', '停用莉莉丝Mod.command', '莉莉丝常驻服务.command', 'LilithMod']


def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def app_manifest(app):
    return {p.relative_to(app).as_posix(): ('link:' + os.readlink(p) if p.is_symlink() else digest(p))
            for p in sorted(app.rglob('*')) if p.is_file() or p.is_symlink()}


def require_stopped():
    rows = subprocess.check_output(['/bin/ps', '-axo', 'pid=,comm='], text=True).splitlines()
    if any(s.rstrip().endswith('/Lilith.app/Contents/MacOS/Lilith') for s in rows):
        raise SystemExit('请先退出所有 Lilith 游戏进程再安装。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['game-dir', 'runtime-source', 'payload', 'data-source', 'node-source']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    game, source, payload, olddata, nodesource = [p.expanduser().resolve() for p in
        [args.game_dir, args.runtime_source, args.payload, args.data_source, args.node_source]]
    app = game / 'Lilith.app'
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != 'com.Nino.Lilith' or info.get('CFBundleShortVersionString') != '1.1.0':
        raise SystemExit('当前安装器只验证官方 com.Nino.Lilith 1.1.0。')
    require_stopped()
    for name in ENTRIES:
        if (game / name).exists() or (game / name).is_symlink():
            raise SystemExit('发现已有附加文件，拒绝覆盖：' + name)
    data = Path.home() / 'Library/Application Support/LilithAI'
    if data.exists(): raise SystemExit('已有正式 Mod 数据，拒绝自动合并或覆盖。')
    metadata = json.loads((ROOT / 'macos-release.json').read_text())
    expected = metadata['artifacts']
    for p, key in [(payload / 'BepInEx/plugins/LilithMod.dll', 'plugin'),
                   (payload / 'BepInEx/plugins/liblilith_macos.dylib', 'native_bridge'),
                   (source / 'BepInEx/core/BepInEx.Unity.IL2CPP.dll', 'loader'),
                   (source / 'BepInEx/core/LilithLoaderCompat.dll', 'loader_compat')]:
        if digest(p) != expected[key]['sha256']: raise SystemExit('验证过的构建哈希不匹配：' + key)
    node = nodesource / 'bin/node'
    version = subprocess.check_output([str(node), '--version'], text=True).strip()
    if not version.startswith('v24.'): raise SystemExit('需要 Node 24。')
    subprocess.run(['/usr/bin/arch', '-x86_64', '/usr/bin/true'], check=True)
    for p in [ROOT / 'scripts/launch-installed-macos.cjs', ROOT / 'scripts/uninstall-installed-macos.cjs', ROOT / 'scripts/companion-service.cjs', ROOT / 'scripts/startup-services.cjs']:
        subprocess.run([str(node), '--check', str(p)], check=True)
    before = app_manifest(app)
    stamp = datetime.now().astimezone().strftime('%Y%m%d-%H%M%S')
    backup = Path.home() / 'Library/Application Support/LilithModBackups' / ('install-' + stamp)
    backup.mkdir(parents=True, mode=0o700)
    for original in [Path.home() / 'Library/Application Support/com.Nino.Lilith',
                     Path.home() / 'Library/Preferences/com.Nino.Lilith.plist']:
        if original.is_dir(): shutil.copytree(original, backup / original.name)
        elif original.is_file(): shutil.copy2(original, backup / original.name)
    (backup / 'original-app-sha256.json').write_text(json.dumps(before, indent=2) + '\n')
    # The original development data stays intact; this extra snapshot includes test tasks.
    shutil.copytree(olddata, backup / 'development-data', ignore=shutil.ignore_patterns('runtime.json', '*.lock'))
    staged_data = backup / 'migrated-data'
    staged_data.mkdir(mode=0o700)
    migrated = []
    for name in ['config.json', 'sessions', 'players', 'artwork', 'art-ui.json', 'ui.json']:
        p = olddata / name
        if p.is_dir(): shutil.copytree(p, staged_data / name)
        elif p.is_file(): shutil.copy2(p, staged_data / name)
        else: continue
        migrated.append(name)
    # Rewrite only exact data-root path values, never conversation prose or secrets.
    def relocate(value):
        if isinstance(value, dict): return {k: relocate(v) for k, v in value.items()}
        if isinstance(value, list): return [relocate(v) for v in value]
        if isinstance(value, str) and value.startswith(str(olddata) + '/'):
            return str(data) + value[len(str(olddata)):]
        return value
    for p in staged_data.rglob('*'):
        if p.is_dir(): p.chmod(0o700)
        elif p.is_file():
            if p.suffix == '.json':
                p.write_text(json.dumps(relocate(json.loads(p.read_text())), ensure_ascii=False, indent=2) + '\n')
            p.chmod(0o600)
    moved = []
    with tempfile.TemporaryDirectory(prefix='.lilith-install-', dir=game) as temporary:
        stage = Path(temporary)
        for name in ['core', 'config', 'interop', 'unity-libs']:
            shutil.copytree(source / 'BepInEx' / name, stage / 'BepInEx' / name)
        shutil.copytree(payload / 'BepInEx/plugins', stage / 'BepInEx/plugins')
        (stage / 'BepInEx/patchers').mkdir()
        shutil.copytree(source / 'dotnet', stage / 'dotnet')
        for name in ['libdoorstop.dylib', 'run_bepinex.sh', '.doorstop_version']:
            shutil.copy2(source / name, stage / name)
        (stage / 'run_bepinex.sh').chmod(0o755)
        (stage / 'Data').symlink_to('Lilith.app/Contents/Resources/Data', target_is_directory=True)
        (stage / 'GameAssembly.dylib').symlink_to('Lilith.app/Contents/Frameworks/GameAssembly.dylib')
        support = stage / 'LilithMod'
        (support / 'runtime/node/bin').mkdir(parents=True)
        shutil.copy2(node, support / 'runtime/node/bin/node')
        shutil.copy2(nodesource / 'LICENSE', support / 'runtime/node/LICENSE')
        for name in ['launch-installed-macos.cjs', 'uninstall-installed-macos.cjs', 'companion-service.cjs', 'startup-services.cjs']:
            shutil.copy2(ROOT / 'scripts' / name, support / name)
        helper = ROOT / '.local-state/LilithLocation.app'
        if helper.is_dir():
            shutil.copytree(helper, support / 'helpers/LilithLocation.app')
        for name in ['LICENSE', 'ASSET-NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'dependencies-macos.json']:
            shutil.copy2(payload / name, support / name)
        shutil.copy2(ROOT / 'loader/LICENSE.upstream-LGPL-2.1.txt', support / 'LICENSE.BepInEx-LGPL-2.1.txt')
        for name, script in [('启动莉莉丝Mod.command', 'launch-installed-macos.cjs'),
                             ('停用莉莉丝Mod.command', 'uninstall-installed-macos.cjs')]:
            (stage / name).write_text('#!/bin/bash\nset -euo pipefail\n'
                'HERE="$(cd "$(dirname "$0")" && pwd)"\n'
                'exec "$HERE/LilithMod/runtime/node/bin/node" "$HERE/LilithMod/' + script + '" "$@"\n')
            (stage / name).chmod(0o755)
        (stage / '莉莉丝常驻服务.command').write_text('#!/bin/bash\nset -euo pipefail\n'
            'HERE="$(cd "$(dirname "$0")" && pwd)"\n'
            'if [ "${1:-start}" = "start" ]; then\n'
            '  exec "$HERE/LilithMod/runtime/node/bin/node" "$HERE/LilithMod/startup-services.cjs"\n'
            'fi\n'
            'exec "$HERE/LilithMod/runtime/node/bin/node" "$HERE/LilithMod/companion-service.cjs" "${1:-start}"\n')
        (stage / '莉莉丝常驻服务.command').chmod(0o755)
        manifest = {'version': metadata['version'], 'game_dir': str(game), 'backup': str(backup),
                    'game_bundle_modified': False, 'installed_entries': ENTRIES,
                    'node_version': version, 'migrated_data': migrated,
                    'dsh_test_tasks': 'retained only in development data and backup; official tasks start fresh',
                    'steam_launch_options_modified': False}
        (support / 'installation.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        instructions = '''# Steam 正式游戏的本机 Mod 测试

这里安装的是 macOS dev6 Mod，使用官方游戏、原游戏存档。游戏 .app 未改动。

## 启动

先启动并登录 Steam，再双击游戏目录中的 `启动莉莉丝Mod.command`；保留终端窗口，F8 / Fn+F8 打开聊天，点击“设置”进入当前配置页。不要同时打开开发副本或原版第二个实例。

若希望 Steam“开始游戏”直接加载 Mod，在 Steam → 游戏属性 → 通用 → 启动选项中填入下面这一整行（包括引号和 %command%）：

```text
''' + '"' + str(game / '启动莉莉丝Mod.command') + '" %command%\n' + '''```

尚未替你更改 Steam 启动选项。只双击 Lilith.app 或直接从未配置启动选项的 Steam 启动，会运行原版。

## 设置、绘图与任务

正式 Mod 数据位于 `~/Library/Application Support/LilithAI/`，迁移了现有密钥配置、记忆、聊天和绘图作品。密钥不会写入安装报告。原游戏使用自己的 `com.Nino.Lilith` 存档；不使用开发副本的游戏进度。DSH 测试任务保留在开发目录和备份，正式版任务队列从空开始。

启动入口会检查聊天后台、DSH、QQ 协议端与 ComfyUI。已有服务直接复用；配置了本机 `startup-services.json` 的 QQ 与 ComfyUI 会自动启动，未配置的服务会显示提示。不会安装依赖、改写登录凭据或解除暂停。QQ 登录过期时仍需本人扫码；退出游戏不会停止已启动的常驻服务。旧设置页的运行令牌已失效，请从游戏里重新打开。

## 停用与备份

退出游戏后双击 `停用莉莉丝Mod.command`：把本次附加文件移入备份，不删除游戏和用户数据。若填写了 Steam 启动选项，请同时清空该选项。

原存档和偏好备份目录：
''' + str(backup) + '''

停用 Mod 不自动恢复旧存档，以免覆盖测试期间新进度。需要回滚进度时，先退出游戏，再从该备份恢复。Steam 更新或验证完整性后若加载失败，请重新检查游戏版本和 interop，勿覆盖新游戏 .app。

这次是“在正式游戏安装位置测试”，Mod 仍为开发预览；没有上传或推送 GitHub。
'''
        (support / '使用说明.md').write_text(instructions)
        require_stopped()
        try:
            for name in ENTRIES:
                (stage / name).rename(game / name)
                moved.append(name)
            shutil.copytree(staged_data, data)
            data.chmod(0o700)
            subprocess.run([str(game / 'LilithMod/runtime/node/bin/node'),
                            str(game / 'LilithMod/launch-installed-macos.cjs'), '--check'], check=True)
            if app_manifest(app) != before: raise RuntimeError('游戏 .app 校验发生变化。')
        except BaseException:
            failed = backup / 'failed-install'; failed.mkdir(exist_ok=True)
            for name in reversed(moved): (game / name).rename(failed / name)
            if data.exists(): data.rename(backup / 'failed-data')
            raise
    manifest['original_app_hashes_verified'] = True
    manifest['installed_files'] = {
        str(p.relative_to(game)): digest(p) for name in ENTRIES for p in
        ([game / name] if (game / name).is_file() else (game / name).rglob('*'))
        if p.is_file() and not p.is_symlink() and not str(p.relative_to(game)).startswith('Data/')}
    (backup / 'installation-report.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in manifest.items() if k != 'installed_files'}, ensure_ascii=False, indent=2))


if __name__ == '__main__': main()
