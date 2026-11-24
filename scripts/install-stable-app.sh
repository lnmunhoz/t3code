#!/bin/bash
# Builds the committed local/custom branch as a packaged app and installs it as
# "T3 Code Stable.app": its own data (~/.t3-stable), its own Electron profile and
# no auto-updates, so it keeps working while the dev checkout is mid-change.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
REF="${1:-local/custom}"
BUILD="$(dirname "$REPO")/t3code-stable-build"
APP_NAME="T3 Code Stable"
APP="$HOME/Applications/$APP_NAME.app"
BUNDLE_ID="com.lnmunhoz.t3code.stable"
T3_HOME="$HOME/.t3-stable"
SEED_FROM="$HOME/.t3/dev"
PLIST_BUDDY=/usr/libexec/PlistBuddy

if [[ "$(osascript -e "application id \"$BUNDLE_ID\" is running" 2>/dev/null)" == "true" ]]; then
  echo "Quit $APP_NAME first, then run this again." >&2
  exit 1
fi

# A dedicated worktree, so only committed code is built and node_modules is reused.
if [[ ! -d "$BUILD" ]]; then
  git -C "$REPO" worktree add --detach "$BUILD" "$REF"
else
  git -C "$BUILD" checkout --detach --force "$REF"
fi
COMMIT="$(git -C "$BUILD" rev-parse --short HEAD)"
echo "Building $APP_NAME from $REF ($COMMIT)"

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
"$PLIST_BUDDY" -c "Set :CFBundleName $APP_NAME" "$PLIST"
"$PLIST_BUDDY" -c "Delete :CFBundleDisplayName" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :CFBundleDisplayName string $APP_NAME" "$PLIST"
"$PLIST_BUDDY" -c "Delete :LSEnvironment" "$PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :LSEnvironment dict" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_HOME string $T3_HOME" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_DESKTOP_USER_DATA_NAME string t3code-stable" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_DISABLE_AUTO_UPDATE string 1" "$PLIST"
"$PLIST_BUDDY" -c "Add :LSEnvironment:T3CODE_COMMIT_HASH string $COMMIT" "$PLIST"
codesign --force --deep --sign - "$APP"

# First install only: start from a copy of the dev app's data. Never touches it again.
if [[ ! -d "$T3_HOME/userdata" && -d "$SEED_FROM" ]]; then
  echo "Seeding $T3_HOME/userdata from $SEED_FROM"
  mkdir -p "$T3_HOME/userdata"
  rsync -a --exclude 'logs/' --exclude '*.sqlite' --exclude '*.sqlite-wal' --exclude '*.sqlite-shm' \
    "$SEED_FROM/" "$T3_HOME/userdata/"
  # The dev app may be running; .backup takes a consistent copy of a live database.
  for db in "$SEED_FROM"/*.sqlite; do
    sqlite3 "$db" ".backup '$T3_HOME/userdata/$(basename "$db")'"
  done
fi

touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
mdimport "$APP" 2>/dev/null || true
echo "Installed $APP ($COMMIT)"
