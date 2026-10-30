#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="${LILITH_PROBE_DIR:-$ROOT/../macos-probe}"
if [ ! -d "$PROBE" ] && [ -z "${LILITH_PROBE_DIR:-}" ]; then PROBE="$ROOT/.local-state"; fi
GAME="${LILITH_GAME_DIR:-$PROBE/game}"
DOTNET="${LILITH_DOTNET_PATH:-$PROBE/runtime/dotnet/dotnet}"
if [ ! -x "$DOTNET" ]; then DOTNET="$(command -v dotnet || true)"; fi
if [ ! -x "$DOTNET" ]; then echo '需要 .NET SDK 8；请设置 LILITH_DOTNET_PATH。' >&2; exit 1; fi
python3 - "$GAME/Lilith.app/Contents/MacOS/Lilith" "${LILITH_BUILD_ONLY:-0}" <<'PY'
import subprocess,sys
if sys.argv[2]=='1':sys.exit(0)
target=sys.argv[1]
running=subprocess.check_output(['ps','-axo','pid=,command='],text=True)
if any(line.strip().split(None,1)[-1].startswith(target) for line in running.splitlines()):
    sys.exit('隔离游戏正在运行；请先退出再构建，避免覆盖正在加载的原生库。')
PY
export DOTNET_CLI_HOME="$PROBE/user-data/dotnet"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
export NUGET_PACKAGES="$PROBE/runtime/nuget"
"$DOTNET" build "$ROOT/plugin/LilithMod.csproj" -c Release --nologo -p:GameDir="$GAME"
PLUGINS="$GAME/BepInEx/plugins"
if [ "${LILITH_BUILD_ONLY:-0}" = 1 ]; then PLUGINS="$ROOT/plugin/bin/Release/net6.0"; fi
mkdir -p "$PLUGINS"
clang -arch x86_64 -mmacosx-version-min="${LILITH_MACOS_MIN_VERSION:-11.0}" \
    -dynamiclib -fobjc-arc -O2 -Wl,-install_name,@rpath/liblilith_macos.dylib -framework AppKit -framework ApplicationServices \
    "$ROOT/native/bridge.m" "$ROOT/native/editor.m" -o "$PLUGINS/liblilith_macos.dylib.new"
mv "$PLUGINS/liblilith_macos.dylib.new" "$PLUGINS/liblilith_macos.dylib"
if [ "${LILITH_BUILD_ONLY:-0}" != 1 ]; then
    cp "$ROOT/plugin/bin/Release/net6.0/LilithMod.dll" "$PLUGINS/LilithMod.dll.new"
    mv "$PLUGINS/LilithMod.dll.new" "$PLUGINS/LilithMod.dll"
fi
if [ -f "$PLUGINS/LilithMacProbe.dll" ]; then
    mkdir -p "$PROBE/runtime/probe-plugin-backup"
    mv "$PLUGINS/LilithMacProbe.dll" "$PROBE/runtime/probe-plugin-backup/LilithMacProbe.dll"
fi
python3 - "$ROOT" "$PLUGINS" <<'PY'
import sys,shutil
from pathlib import Path
root,plugins=map(Path,sys.argv[1:])
for name in ['companion','character','locales']:
    shutil.copytree(root/name,plugins/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns(
        'node_modules','.test-*','private-source','translation-cache','translation-work','candidates.local.json'))
shutil.copytree(root/'plugin/assets',plugins/'assets',dirs_exist_ok=True)
PY
