#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if ! /bin/bash "$ROOT/scripts/bootstrap-macos.sh" --launch "$@"; then
  echo '部署未完成。请保留上方错误，参阅 docs/deployment-macos.md。'
  read -r -p '按回车关闭…' _
  exit 1
fi
