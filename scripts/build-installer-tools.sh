#!/bin/bash
# Maintainer build: only the port's helper/patcher/dispatcher go into the setup.
# The modified upstream loader here is a validation artifact, not redistributed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${LILITH_GAME_DIR:?Set LILITH_GAME_DIR}/BepInEx/core"
DOTNET="${LILITH_DOTNET_PATH:?Set LILITH_DOTNET_PATH to SDK 8}"
ORIGINAL="${1:?Original upstream loader DLL}"
OUT="${2:?New output directory}"
[ ! -e "$OUT" ] || { echo '输出目录已存在，拒绝覆盖。' >&2; exit 1; }
mkdir -p "$OUT/installer-tools"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
"$DOTNET" build "$ROOT/loader/compat/LoaderCompat.csproj" -c Release --nologo
"$DOTNET" build "$ROOT/loader/patcher/LoaderPatcher.csproj" -c Release --nologo -p:BepInExCorePath="$CORE"
cp "$ROOT/loader/compat/bin/Release/net6.0/LilithLoaderCompat.dll" "$OUT/"
for name in LoaderPatcher.dll LoaderPatcher.deps.json LoaderPatcher.runtimeconfig.json; do
  cp "$ROOT/loader/patcher/bin/Release/net8.0/$name" "$OUT/installer-tools/"
done
clang -arch x86_64 -mmacosx-version-min=11.0 -dynamiclib -O2 \
  -Wl,-install_name,@rpath/liblilith_probe_dispatch.dylib "$ROOT/loader/compat/dispatch.c" -o "$OUT/liblilith_probe_dispatch.dylib"
"$DOTNET" "$ROOT/loader/patcher/bin/Release/net8.0/LoaderPatcher.dll" "$ORIGINAL" "$OUT/LilithLoaderCompat.dll" "$OUT/BepInEx.Unity.IL2CPP.dll"
