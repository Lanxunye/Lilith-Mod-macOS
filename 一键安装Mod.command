#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
if ! /bin/bash "$ROOT/scripts/bootstrap-macos.sh" --game --launch "$@"; then
  echo '安装未完成。请保留上方提示，打开 docs/deployment-macos.md 查看对应处理方法。'
  read -r -p '按回车关闭…' _
  exit 1
fi
