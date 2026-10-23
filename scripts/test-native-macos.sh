#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBRARY="${1:-$ROOT/plugin/bin/Release/net6.0/liblilith_macos.dylib}"
OUTPUT="$(mktemp -d "${TMPDIR:-/tmp}/lilith-native-namespace.XXXXXX")"
trap 'rm -rf "$OUTPUT"' EXIT
clang -arch x86_64 -mmacosx-version-min=11.0 -fobjc-arc \
    -framework Foundation -framework AppKit "$ROOT/native/tests/class-namespace.m" -o "$OUTPUT/check"
/usr/bin/arch -x86_64 "$OUTPUT/check" "$LIBRARY"
