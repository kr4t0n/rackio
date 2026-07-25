#!/usr/bin/env bash
#
# Build RackioWallpaper.app from the Swift sources. No Xcode project, no
# SwiftPM manifest — swiftc plus a hand-assembled bundle is enough for a
# single unsandboxed AppKit binary, and it keeps the whole app reviewable.
#
#   ./build.sh          build only
#   ./build.sh --run    build, then relaunch
#
set -euo pipefail
cd "$(dirname "$0")"

APP="build/RackioWallpaper.app"
BIN="$APP/Contents/MacOS/RackioWallpaper"

if ! command -v swiftc >/dev/null 2>&1; then
	echo "swiftc not found — install the Xcode command line tools:" >&2
	echo "  xcode-select --install" >&2
	exit 1
fi

echo "==> Compiling"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -whole-module-optimization \
	-target "$(uname -m)-apple-macos13.0" \
	-o "$BIN" \
	Sources/*.swift

cp Info.plist "$APP/Contents/Info.plist"

# Ad-hoc signature. Unsigned AppKit bundles get inconsistent treatment from
# TCC and Gatekeeper on recent macOS; a local signature is free and avoids it.
echo "==> Signing (ad-hoc)"
codesign --force --sign - "$APP"

echo "==> Built $APP"

if [[ "${1:-}" == "--run" ]]; then
	echo "==> Relaunching"
	pkill -f "RackioWallpaper" 2>/dev/null || true
	open "$APP"
fi
