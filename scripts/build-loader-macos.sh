#!/bin/bash
# Reproduce the loader compatibility patch from the exact upstream input. Never installs it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${LILITH_GAME_DIR:?Set LILITH_GAME_DIR to the BepInEx game directory}/BepInEx/core"
INPUT="${1:?Pass the ORIGINAL be.790 BepInEx.Unity.IL2CPP.dll as argument 1}"
OUTPUT="${2:?Pass a NEW output directory as argument 2}"
DOTNET="${LILITH_DOTNET_PATH:-$(command -v dotnet || true)}"
if [ ! -x "$DOTNET" ]; then echo '需要 .NET SDK 8。' >&2; exit 1; fi
python3 - "$INPUT" "$OUTPUT" <<'PY'
import hashlib,sys
from pathlib import Path
source,output=map(Path,sys.argv[1:])
if hashlib.sha256(source.read_bytes()).hexdigest()!='afc9cc7e3c407cf1324c1cb669addd6fd162354ffec9bbb83b78c83ca6941305':
    raise SystemExit('Original be.790 loader SHA-256 does not match; refusing to patch.')
if output.exists():raise SystemExit('Output directory already exists; refusing to overwrite.')
output.mkdir(parents=True)
PY
"$DOTNET" build "$ROOT/loader/compat/LoaderCompat.csproj" -c Release --nologo
"$DOTNET" build "$ROOT/loader/patcher/LoaderPatcher.csproj" -c Release --nologo -p:BepInExCorePath="$CORE"
cp "$ROOT/loader/compat/bin/Release/net6.0/LilithLoaderCompat.dll" "$OUTPUT/"
clang -arch x86_64 -mmacosx-version-min="${LILITH_MACOS_MIN_VERSION:-11.0}" -dynamiclib -O2 \
    -Wl,-install_name,@rpath/liblilith_probe_dispatch.dylib "$ROOT/loader/compat/dispatch.c" -o "$OUTPUT/liblilith_probe_dispatch.dylib"
"$DOTNET" "$ROOT/loader/patcher/bin/Release/net8.0/LoaderPatcher.dll" "$INPUT" "$OUTPUT/LilithLoaderCompat.dll" "$OUTPUT/BepInEx.Unity.IL2CPP.dll"
