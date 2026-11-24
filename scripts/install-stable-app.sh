#!/bin/bash
# Builds this checkout as it is now (uncommitted work included) into a packaged
# app and installs it as "T3 Code Stable.app". It uses T3 Code Nightly's data and
# settings (~/.t3/userdata), so only one of the two can be open at a time, with its
# own Electron profile and no auto-updates, so it keeps working while the dev
# checkout is mid-change. Run it again to update the app to the checkout's state.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$(dirname "$REPO")/$(basename "$REPO")-stable-build"
APP_NAME="T3 Code Stable"
APP="$HOME/Applications/$APP_NAME.app"
BUNDLE_ID="com.lnmunhoz.t3code.stable"
PLIST_BUDDY=/usr/libexec/PlistBuddy

if [[ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]; then
  echo "Quit $APP_NAME first, then run this again." >&2
  exit 1
fi

# Snapshot the working tree (tracked changes and new files, not ignored ones)
# into a commit through a throwaway index, so the branch and index stay as they are.
INDEX="$(mktemp -u)"
GIT_INDEX_FILE="$INDEX" git -C "$REPO" read-tree HEAD
GIT_INDEX_FILE="$INDEX" git -C "$REPO" add -A
SNAPSHOT="$(git -C "$REPO" commit-tree "$(GIT_INDEX_FILE="$INDEX" git -C "$REPO" write-tree)" -p HEAD -m "T3 Code Stable snapshot")"
rm -f "$INDEX"
LABEL="$(git -C "$REPO" rev-parse --short HEAD)"
if ! git -C "$REPO" diff --quiet HEAD || [[ -n "$(git -C "$REPO" ls-files --others --exclude-standard)" ]]; then
  LABEL="$LABEL+wip"
fi

# A dedicated worktree reuses node_modules between builds.
if [[ ! -d "$BUILD" ]]; then
  git -C "$REPO" worktree add --detach "$BUILD" "$SNAPSHOT"
else
  git -C "$BUILD" checkout --detach --force "$SNAPSHOT"
fi
echo "Building $APP_NAME from $REPO ($LABEL)"

cd "$BUILD"
"$REPO/node_modules/.bin/vp" i
# The artifact build spawns `vp` by name.
export PATH="$BUILD/node_modules/.bin:$PATH"
OUT="$(mktemp -d)"
node scripts/build-desktop-artifact.ts --platform mac --target dir --arch arm64 --output-dir "$OUT"
BUILT_APP="$(find "$OUT" -maxdepth 3 -name '*.app' -type d | head -1)"
[[ -n "$BUILT_APP" ]] || { echo "No .app found in $OUT" >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$(dirname "$APP")"
ditto "$BUILT_APP" "$APP"
rm -rf "$OUT"

PLIST="$APP/Contents/Info.plist"
"$PLIST_BUDDY" -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PLIST"
# Keep CFBundleName: Electron finds "<CFBundleName> Helper.app" by it and aborts without it.
"$PLIST_BUDDY" -c "Delete :CFBundleDisplayName" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
"$PLIST_BUDDY" -c "Delete :LSEnvironment" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :LSEnvironment dict" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_DESKTOP_USER_DATA_NAME string t3code-stable" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_DISABLE_AUTO_UPDATE string 1" "$PLIST"
# T3 Code Dev's web client reaches this server on a fixed port.
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_PORT string 3773" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_COMMIT_HASH string ${LABEL%+wip}" "$PLIST"
codesign --force --deep --sign - "$APP"

touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
mdimport "$APP" 2>/dev/null || true
echo "Installed $APP ($LABEL)"
