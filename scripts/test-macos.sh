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
export PATH="$(dirname "$NODE"):$PATH"
"$NODE" "$ROOT/tests/installer-macos.cjs"
"$NODE" "$ROOT/tests/loader-installer.cjs"
"$NODE" "$ROOT/tests/restart-services.cjs"
(cd "$ROOT/companion" && "$NODE" --run test)
for suite in chat-view-model cross-screen-ground dialogue-formatter player-line-options runtime-resources mac-music-player shared-chat-bridge; do
    for project in "$ROOT/tests/$suite/"*.csproj; do
        "$DOTNET" run --project "$project" -c Release --nologo
    done
done
