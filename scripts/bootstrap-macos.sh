#!/bin/bash
# Download only the pinned official Node runtime; never request sudo or disable Gatekeeper.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(uname -s)" = Darwin ] || { echo '此入口仅支持 macOS。'; exit 1; }
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) EXPECTED=89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7 ;;
  x86_64) ARCH=x64; EXPECTED=d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035 ;;
  *) echo '不支持的处理器架构。'; exit 1 ;;
esac
CACHE="${LILITH_INSTALL_ROOT:-$HOME/Library/Application Support/LilithMod}/runtime/node-v24.22.1-darwin-$ARCH"
if [ ! -x "$CACHE/bin/node" ]; then
  echo '下载 Node.js 24.22.1（官方 nodejs.org；仅安装到当前用户目录）…'
  mkdir -p "$(dirname "$CACHE")"
  TEMP="$(mktemp -d "$(dirname "$CACHE")/.node-download.XXXXXX")"
  trap 'rm -rf "$TEMP"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 600 --retry 2 \
    "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-$ARCH.tar.gz" -o "$TEMP/node.tar.gz"
  ACTUAL="$(shasum -a 256 "$TEMP/node.tar.gz" | awk '{print $1}')"
  [ "$ACTUAL" = "$EXPECTED" ] || { echo 'Node 下载校验失败，未执行下载内容。'; exit 1; }
  tar -xzf "$TEMP/node.tar.gz" -C "$TEMP"
  mv "$TEMP/node-v24.22.1-darwin-$ARCH" "$CACHE"
fi
exec "$CACHE/bin/node" "$ROOT/scripts/install-macos.cjs" "$@"
