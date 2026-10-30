#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
/bin/bash "$ROOT/scripts/bootstrap-macos.sh" --restart-services "$@"
