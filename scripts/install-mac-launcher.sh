#!/bin/bash
# Installs "T3 Code Custom.app" into ~/Applications so Spotlight and Raycast can
# launch this checkout's desktop app (`vp run dev:desktop`) like any other app.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="T3 Code Custom"
APP="$HOME/Applications/$APP_NAME.app"
ICON_PNG="$REPO/assets/dev/blueprint-macos-1024.png"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>com.lnmunhoz.t3code.custom-launcher</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat >"$APP/Contents/MacOS/launcher" <<LAUNCHER
#!/bin/zsh -l
# Brings the running dev app forward, or starts \`vp run dev:desktop\` in $REPO.
REPO="$REPO"
DEV_APP_ID="com.t3tools.t3code.dev.t3code"
RUNNER_LOCK="\$REPO/apps/desktop/.electron-runtime/dev-desktop.pid"
LOG="\$HOME/Library/Logs/t3code-custom.log"
mkdir -p "\$(dirname "\$LOG")"

if [[ "\$(osascript -e "application id \"\$DEV_APP_ID\" is running")" == "true" ]]; then
  open -b "\$DEV_APP_ID"
  exit 0
fi

# Quitting the window leaves the dev runner idle, and it refuses a second
# runner, so stop the idle one by the PID it recorded in its lock file.
runner_pid="\$(cat "\$RUNNER_LOCK" 2>/dev/null)"
if [[ -n "\$runner_pid" ]] && kill -0 "\$runner_pid" 2>/dev/null; then
  kill -TERM "\$runner_pid"
  for _ in {1..50}; do kill -0 "\$runner_pid" 2>/dev/null || break; sleep 0.2; done
fi

cd "\$REPO"
echo "=== \$(date) starting dev:desktop ===" >>"\$LOG"
nohup "\$REPO/node_modules/.bin/vp" run dev:desktop >>"\$LOG" 2>&1 &
LAUNCHER
chmod +x "$APP/Contents/MacOS/launcher"

ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"
rm -rf "$(dirname "$ICONSET")"

touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
mdimport "$APP" 2>/dev/null || true
echo "Installed $APP"
