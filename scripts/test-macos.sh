#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE="${LILITH_PROBE_DIR:-$ROOT/../macos-probe}"
if [ ! -d "$PROBE" ] && [ -z "${LILITH_PROBE_DIR:-}" ]; then PROBE="$ROOT/.local-state"; fi
DOTNET="${LILITH_DOTNET_PATH:-$PROBE/runtime/dotnet/dotnet}"
if [ ! -x "$DOTNET" ]; then DOTNET="$(command -v dotnet || true)"; fi
if [ ! -x "$DOTNET" ]; then echo '需要 .NET SDK 8；请设置 LILITH_DOTNET_PATH。' >&2; exit 1; fi
export DOTNET_CLI_HOME="$PROBE/user-data/dotnet"
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_GENERATE_ASPNET_CERTIFICATE=false
export NUGET_PACKAGES="$PROBE/runtime/nuget"
NODE="${LILITH_NODE_PATH:-$(command -v node || true)}"
if [ -z "$NODE" ]; then NODE="$HOME/.nvm/versions/node/v24.18.0/bin/node"; fi
"$NODE" -e 'if(!process.versions.node.startsWith("24."))throw Error("Node 24 required")'
python3 - "$ROOT" "$NODE" "$DOTNET" <<'PY'
from pathlib import Path
import subprocess,sys
root=Path(sys.argv[1]);node=sys.argv[2];sdk=sys.argv[3]
tests=['localization','locale-prompts','lore','lore-candidates','local-context','response-normalization',
       'update-check','smoke','provider-compat','provider-reliability','provider-dns','provider-recovery',
       'gemini-interactions','language-retry','process-lifecycle','mac-api','artwork','dsh-tasks','dsh-routing','dsh-runtime','qq-bridge','qq-groups','qq-speakers','companion-service','conversation-store']
for test in tests:
    subprocess.run([node,'test/'+test+'.js'],cwd=root/'companion',check=True)
for project in sorted((root/'tests').rglob('*.csproj')):
    if project.parent.name=='music-player-locator':
        print('SKIP Windows registry/path fixture: music-player-locator',flush=True);continue
    subprocess.run([sdk,'run','--project',str(project),'-c','Release','--nologo'],check=True)
PY
