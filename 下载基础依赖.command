#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "$ROOT/scripts/bootstrap-macos.sh" --dependencies-only "$@"
read -r -p '下载流程结束，按回车关闭…' _
