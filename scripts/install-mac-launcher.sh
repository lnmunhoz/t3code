#!/bin/bash
# Installs "T3 Dev.app" into ~/Applications for Spotlight and Raycast. It runs this
# checkout's Electron desktop app in dev mode (`vp run dev:desktop`) with its local
# environment off, connected to T3 Code Stable's server as a saved backend, so dev
# shows the same projects and threads and has every desktop-only feature (Tasks,
# browser panel). Client changes show up live; server changes need `vp run install:stable`.
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
SERVER_URL="http://127.0.0.1:3773"
# Its own Electron profile (single-instance lock) and state, apart from Stable and plain dev:desktop.
export T3CODE_DESKTOP_USER_DATA_NAME="t3code-t3-dev"
T3_DEV_HOME="\$HOME/.t3/t3-dev"
STATE="\$T3_DEV_HOME/userdata"
PROFILE="\$HOME/Library/Application Support/\$T3CODE_DESKTOP_USER_DATA_NAME"
RUNNER_PID_FILE="\$T3_DEV_HOME/launcher.pid"
DESKTOP_LOCK="\$REPO/apps/desktop/.electron-runtime/dev-desktop.pid"
ELECTRON="\$REPO/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher"
LOG="\$HOME/Library/Logs/t3code-dev.log"
mkdir -p "\$STATE" "\$(dirname "\$LOG")"
notify() { osascript -e "display notification \"\$1\" with title \"T3 Dev\""; }
up() { curl -s -o /dev/null -m 2 "\$1"; }
alive() { [[ -n "\$1" ]] && kill -0 "\$1" 2>/dev/null; }
# Chromium's SingletonLock names the pid holding the profile.
app_up() { alive "\$(readlink "\$PROFILE/SingletonLock" 2>/dev/null | sed 's/.*-//')"; }
# A second instance hands its arguments to the running app (or just brings it forward) and exits.
to_app() { T3CODE_HOME="\$T3_DEV_HOME" "\$ELECTRON" "\$@" >>"\$LOG" 2>&1 & }

# Dev uses Stable's server, so Stable has to be running.
if ! up "\$SERVER_URL/.well-known/t3/environment"; then
  open -g -b "\$STABLE_ID"
  for _ in {1..120}; do up "\$SERVER_URL/.well-known/t3/environment" && break; sleep 0.5; done
  up "\$SERVER_URL/.well-known/t3/environment" || { notify "T3 Code Stable's server didn't start."; exit 1; }
fi

runner="\$(cat "\$RUNNER_PID_FILE" 2>/dev/null)"
if ! { alive "\$runner" && ps -o command= -p "\$runner" | grep -q 'dev:desktop'; }; then
  holder="\$(cat "\$DESKTOP_LOCK" 2>/dev/null)"
  if alive "\$holder"; then
    notify "Another vp run dev:desktop (pid \$holder) is running in this checkout. Stop it to open T3 Dev."
    exit 1
  fi
  # No local backend: this app must never start a server, and Stable owns ~/.t3/userdata.
  [[ -f "\$STATE/desktop-settings.json" ]] || echo '{"localEnvironmentEnabled":false}' >"\$STATE/desktop-settings.json"
  cd "\$REPO"
  echo "=== \$(date) starting dev:desktop ===" >>"\$LOG"
  T3CODE_PORT_OFFSET=40 nohup "\$REPO/node_modules/.bin/vp" run dev:desktop --home-dir "\$T3_DEV_HOME" >>"\$LOG" 2>&1 &
  echo \$! >"\$RUNNER_PID_FILE"
fi
# Talking to the app before it holds its profile would start a stray, unsupervised copy.
for _ in {1..360}; do app_up && break; sleep 0.5; done
app_up || { notify "The dev app didn't start. See ~/Library/Logs/t3code-dev.log"; exit 1; }

# First run: add Stable's server as a saved backend; the app asks to confirm the host once.
# The app's connection list is encrypted, so a marker records it. Delete it to pair again.
if [[ ! -f "\$STATE/paired-stable" ]]; then
  token="\$(\$HOME/.t3/bin/t3 pair --label "T3 Dev" --ttl 5m 2>/dev/null | sed -n 's/^Token: //p')"
  if [[ -n "\$token" ]]; then
    link="\$(node -e 'console.log("t3code-dev://pair?pairingUrl=" + encodeURIComponent(process.argv[1]))' "\$SERVER_URL/pair#token=\$token")"
    to_app "\$link"
    touch "\$STATE/paired-stable"
    exit 0
  fi
fi
to_app
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
