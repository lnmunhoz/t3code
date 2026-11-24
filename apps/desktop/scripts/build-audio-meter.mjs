import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// oxlint-disable-next-line t3code/no-global-process-runtime -- Native compilation only runs on the actual macOS host; this script has no Effect runtime.
const hostPlatform = process.platform;

// The music bars' meter is macOS-only. A missing Swift toolchain only turns the bars off.
if (hostPlatform === "darwin") {
  const root = NodeURL.fileURLToPath(new URL("../../../native/audio-meter/", import.meta.url));
  const source = NodePath.join(root, "main.swift");
  const output = NodePath.join(root, "build", "t3-audio-meter");
  let current = false;
  try {
    current = NodeFS.statSync(output).mtimeMs >= NodeFS.statSync(source).mtimeMs;
  } catch {}
  if (!current) {
    NodeFS.mkdirSync(NodePath.dirname(output), { recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    try {
      NodeChildProcess.execFileSync("swiftc", ["-O", source, "-o", temporary], {
        stdio: "inherit",
      });
      NodeFS.renameSync(temporary, output);
    } catch (error) {
      console.warn(`[audio-meter] Not built, so music bars stay off: ${error.message}`);
    } finally {
      NodeFS.rmSync(temporary, { force: true });
    }
  }
}
