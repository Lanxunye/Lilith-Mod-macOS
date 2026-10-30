#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-$ROOT/.local-state/LilithLocation.app}"
mkdir -p "$TARGET/Contents/MacOS" "$ROOT/.local-state/swift-module-cache"
cp "$ROOT/native/location-helper/Info.plist" "$TARGET/Contents/Info.plist"
xcrun swiftc -module-cache-path "$ROOT/.local-state/swift-module-cache" -O -framework AppKit -framework CoreLocation "$ROOT/native/location-helper/Location.swift" -o "$TARGET/Contents/MacOS/LilithLocation"
codesign --force --sign - --identifier com.lilith.companion.location "$TARGET"
