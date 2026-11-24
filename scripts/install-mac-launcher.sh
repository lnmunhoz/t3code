#!/bin/bash
# Installs "T3 Dev.app" into ~/Applications for Spotlight and Raycast. It runs
# this checkout's web client (`vp run dev:web`) against T3 Code Stable's server, so
# dev shows the same projects and threads, and opens it in its own Chrome window.
# Client changes show up live; server changes need `vp run install:stable`.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="T3 Dev"
APP="$HOME/Applications/$APP_NAME.app"
ICON_PNG="$REPO/assets/dev/blueprint-macos-1024.png"

rm -rf "$HOME/Applications/T3 Code Custom.app" "$HOME/Applications/T3 Code Dev.app" "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>com.lnmunhoz.t3code.dev-launcher</string>
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
REPO="$REPO"
STABLE_ID="com.lnmunhoz.t3code.stable"
SERVER_PORT=3773
# A fixed offset keeps the web port, and with it the browser's sign-in, stable.
WEB_OFFSET=40
WEB_PORT=\$((5733 + WEB_OFFSET))
URL="http://localhost:\$WEB_PORT"
STATE="\$HOME/Library/Application Support/t3code-dev-web"
LOG="\$HOME/Library/Logs/t3code-dev.log"
mkdir -p "\$STATE" "\$(dirname "\$LOG")"
notify() { osascript -e "display notification \"\$1\" with title \"T3 Dev\""; }
up() { curl -s -o /dev/null -m 2 "\$1"; }

# Dev uses Stable's server, so Stable has to be running.
if ! up "http://127.0.0.1:\$SERVER_PORT/.well-known/t3/environment"; then
  open -g -b "\$STABLE_ID"
  for _ in {1..120}; do up "http://127.0.0.1:\$SERVER_PORT/.well-known/t3/environment" && break; sleep 0.5; done
  up "http://127.0.0.1:\$SERVER_PORT/.well-known/t3/environment" || { notify "T3 Code Stable's server didn't start."; exit 1; }
fi

if ! up "\$URL/"; then
  cd "\$REPO"
  echo "=== \$(date) starting dev:web ===" >>"\$LOG"
  T3CODE_PORT_OFFSET=\$WEB_OFFSET nohup "\$REPO/node_modules/.bin/vp" run dev:web --port \$SERVER_PORT >>"\$LOG" 2>&1 &
  for _ in {1..120}; do up "\$URL/" && break; sleep 0.5; done
  up "\$URL/" || { notify "The dev web client didn't start. See ~/Library/Logs/t3code-dev.log"; exit 1; }
fi

# Sign this window's browser profile in to Stable's server; sessions last 30 days.
TARGET="\$URL/"
if [[ ! -f "\$STATE/paired" || -n "\$(find "\$STATE/paired" -mtime +25)" ]]; then
  token="\$(\$HOME/.t3/bin/t3 pair --label "T3 Dev" --ttl 5m 2>/dev/null | sed -n 's/^Token: //p')"
  [[ -n "\$token" ]] && TARGET="\$URL/pair#token=\$token" && touch "\$STATE/paired"
fi

open -na "Google Chrome" --args --user-data-dir="\$STATE/chrome" --no-first-run --no-default-browser-check --app="\$TARGET"
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
