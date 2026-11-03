#!/bin/bash
# Builds a universal SciLook.app (Apple silicon and Intel) into ./build, with the Quick Look
# extension inside, and signs both.
#
#   scripts/build-app.sh            ad-hoc signature, for running on this Mac
#   SIGN_IDENTITY="Developer ID Application: ..." scripts/build-app.sh
set -euo pipefail

cd "$(dirname "$0")/.."

identity="${SIGN_IDENTITY:--}"
timestamp="--timestamp=none"
if [[ "$identity" != "-" ]]; then
	timestamp="--timestamp"
fi
app="build/SciLook.app"
appex="$app/Contents/PlugIns/SciLookPreview.appex"

# Each architecture is built on its own and then combined, which works with just the Command Line
# Tools. Building both in one step needs Xcode.
apps=()
previews=()
for arch in arm64 x86_64; do
	triple="$arch-apple-macosx14.0"
	swift build -c release --triple "$triple" --product SciLook
	swift build -c release --triple "$triple" --product SciLookPreview
	bin="$(swift build -c release --triple "$triple" --show-bin-path)"
	apps+=("$bin/SciLook")
	previews+=("$bin/SciLookPreview")
done

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$appex/Contents/MacOS" "$appex/Contents/Resources"
lipo -create "${apps[@]}" -output "$app/Contents/MacOS/SciLook"
lipo -create "${previews[@]}" -output "$appex/Contents/MacOS/SciLookPreview"
cp Resources/Info.plist "$app/Contents/Info.plist"
cp Resources/Preview-Info.plist "$appex/Contents/Info.plist"
cp Resources/AppIcon.icns "$app/Contents/Resources/AppIcon.icns"
# The preview code goes in the extension's own Resources, where Renderer looks first.
cp Sources/SciLookCore/Resources/scilook.js "$appex/Contents/Resources/scilook.js"

# Sandboxed with no other entitlement: Quick Look hands the extension read access to the one file
# it previews. Neither holds a permission grant, so the identifier-only requirement is safe, and
# it keeps updates recognized as the same app. A Developer ID signature brings its own.
sign() {
	local path="$1" id="$2" entitlements="$3"
	local requirement=()
	if [[ "$identity" == "-" ]]; then
		requirement=(--requirements "=designated => identifier \"$id\"")
	fi
	codesign --force --options runtime "$timestamp" --entitlements "$entitlements" \
		${requirement[@]+"${requirement[@]}"} --sign "$identity" "$path"
}
sign "$appex" com.stanczykwyatt.SciLook.Preview Resources/Preview.entitlements
sign "$app" com.stanczykwyatt.SciLook Resources/SciLook.entitlements
codesign --verify --strict --deep "$app"

echo "Built $app"
