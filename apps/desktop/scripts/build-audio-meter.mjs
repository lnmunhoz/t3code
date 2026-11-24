import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Native compilation only runs on the actual macOS host; this script has no Effect runtime.
const hostPlatform = process.platform;

// The music bars' meter is macOS-only. A missing Swift toolchain only turns the bars off.
// It ships as a small app bundle: macOS shows its Microphone prompt, and lists it in System
// Settings, only for apps, never for a bare command-line tool.
if (hostPlatform === "darwin") {
  const root = NodeURL.fileURLToPath(new URL("../../../native/audio-meter/", import.meta.url));
  const source = NodePath.join(root, "main.swift");
  const infoPlist = NodePath.join(root, "Info.plist");
  const bundle = NodePath.join(root, "build", "T3 Code Music Meter.app");
  const output = NodePath.join(bundle, "Contents", "MacOS", "t3-audio-meter");
  let current = false;
  try {
    const built = NodeFS.statSync(output).mtimeMs;
    current =
      built >= NodeFS.statSync(source).mtimeMs && built >= NodeFS.statSync(infoPlist).mtimeMs;
  } catch {}
  if (!current) {
    const temporary = `${bundle}.${process.pid}.tmp`;
    try {
      const binary = NodePath.join(temporary, "Contents", "MacOS", "t3-audio-meter");
      NodeFS.mkdirSync(NodePath.dirname(binary), { recursive: true });
      NodeFS.copyFileSync(infoPlist, NodePath.join(temporary, "Contents", "Info.plist"));
      NodeChildProcess.execFileSync("swiftc", ["-O", source, "-o", binary], { stdio: "inherit" });
      // A stable identifier keeps the permission attached across rebuilds.
      NodeChildProcess.execFileSync(
        "codesign",
        ["--force", "--sign", "-", "--identifier", "com.t3tools.audio-meter", temporary],
        { stdio: "inherit" },
      );
      NodeFS.rmSync(bundle, { recursive: true, force: true });
      NodeFS.renameSync(temporary, bundle);
    } catch (error) {
      console.warn(`[audio-meter] Not built, so music bars stay off: ${error.message}`);
    } finally {
      NodeFS.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
