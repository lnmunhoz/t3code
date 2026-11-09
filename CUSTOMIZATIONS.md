# Customizations

A running history of every change made to this custom version of T3 Code, newest first. See the "This is a custom fork" section in [AGENTS.md](AGENTS.md) for how to add entries.

Each entry: date, title, what changed, and why.

---

## 2026-11-09 — Keep pasted text that comes with an image

**What:** When a paste carries an image together with text, the composer now attaches the image and also inserts the text, instead of dropping the text. Finder's copied file names or paths are still ignored. `pastedTextBesideAttachments` in `apps/web/src/components/chat/composerAttachmentFiles.ts` decides which text to keep, and `onComposerPaste` in `apps/web/src/components/chat/ChatComposer.tsx` inserts it (long text still folds into an attachment as usual).

**Why:** Copying an annotation from Focus Dot (a prompt with its marked-up screenshot) pasted only the image into T3 Code, while Claude Desktop kept both. Wanted T3 Code to accept the same format as Claude so the same Copy works in both.

## 2026-11-09 — Fix Kokoro failing to load in dev

**What:** `apps/web/src/speech/kokoro.worker.ts` now overrides only the ONNX runtime's `.wasm` path. Its `.mjs` glue is already embedded in the bundled runtime, and in Vite's bundled dev mode a `?url` import of that file returned its source text, so loading failed with "no available backend found". `apps/web/src/speech/kokoroSpeech.ts` also shortens load errors shown in Settings to one line.

**Why:** Picking Kokoro in the dev app showed a huge "Kokoro failed to load" error in Settings.

## 2026-11-09 — Kokoro neural voice for spoken notifications

**What:** Spoken notifications can use Kokoro-82M, a neural TTS model that runs locally in a Web Worker, as well as the system voices. Settings › General › Notifications gains a Voice engine picker (System voices / Kokoro), a Kokoro model row (download with progress, remove download), a Kokoro voice picker and a speech rate. The model downloads once from Hugging Face into the browser cache and runs on WebGPU in fp32 (~330 MB, ~0.3–0.6 s per alert on an M-series Mac), or on WASM q8 (~90 MB, 4–8 s) when no GPU adapter is available. It unloads after 10 idle minutes, and alerts fall back to the system voice whenever Kokoro cannot speak. This completes the "Local voice model dependency (kokoro-js)" work-in-progress entry below. Key files: `apps/web/src/speech/kokoro.worker.ts`, `apps/web/src/speech/kokoroSpeech.ts`, `apps/web/src/notificationSpeech.ts`, `apps/web/src/components/settings/NotificationSettings.tsx`, `packages/contracts/src/settings.ts`; `apps/web/vite.config.ts` aliases Transformers.js's ONNX runtime files so they are bundled instead of loaded from jsDelivr (blocked by the desktop CSP); `third-party-licenses.config.json` adds notices for the new transitive packages.

**Why:** The system voices sounded awful (one sounded scary). Wanted a realistic voice that runs locally without using too many resources.

## 2026-11-09 — README notes the fork

**What:** Added a `[!NOTE]` alert under the `README.md` title saying this is a customized fork and linking here.

**Why:** Anyone landing on the fork should immediately know it differs from upstream and where to see how.

## 2026-11-09 — Fork default branch is local/custom

**What:** Set the default branch of https://github.com/lnmunhoz/t3code to `local/custom` (GitHub repo setting). The fork's `main` stays a plain mirror of upstream.

**Why:** Visitors to the fork should land on the customized version, not a copy of upstream.

## 2026-11-09 — Auto-push to fork after each commit

**What:** Added `.vite-hooks/post-commit`, which pushes `local/custom` to the `fork` remote in the background after every commit on that branch.

**Why:** Keep the public fork in sync automatically instead of relying on remembering to push.

## 2026-11-09 — Customization log and fork tracking

**What:** Added the "This is a custom fork" section to `AGENTS.md` and created this file. Created the public fork https://github.com/lnmunhoz/t3code, added it as the `fork` remote, and `local/custom` is pushed there after each commit.

**Why:** Keep a durable record of every customization and the motivation behind it, so we can always look back later (and know what to carry forward when syncing with upstream). The fork backs up the custom work and is open source.

## 2026-11-09 — Local voice model dependency (kokoro-js), uncommitted

**What:** Added `kokoro-js` to `apps/web/package.json` and disabled build scripts for `onnxruntime-node` and `protobufjs` in `pnpm-workspace.yaml` (the web app only uses the onnxruntime-web backend).

**Why:** Work in progress toward higher-quality spoken notifications with a local TTS model instead of only the system Web Speech voices.

## 2026-11-09 — Desktop dev no longer auto-opens DevTools, uncommitted

**What:** Removed the `openDevTools({ mode: "detach" })` call for development builds in `apps/desktop/src/window/DesktopWindow.ts`.

**Why:** A detached DevTools window popping up on every desktop dev launch was distracting.

## 2026-11-09 — Spoken thread notifications (`2ece8b98c2`)

**What:** Thread alerts can say the thread title aloud ("<title> complete", "<title> needs approval", "<title> failed") via the Web Speech API, after the chime or instead of it. Follows the existing sound modes, queues instead of overlapping, and supports any installed voice. Key files: `apps/web/src/notificationSpeech.ts`, `apps/web/src/threadNotifications.ts`, `apps/web/src/components/settings/NotificationSettings.tsx`, `packages/contracts/src/settings.ts`.

**Why:** Know which thread finished or needs attention without looking at the screen.

## 2026-11-09 — Thread sidebar can resize almost full-width (`f2362e1380`)

**What:** Lowered `THREAD_MAIN_CONTENT_MIN_WIDTH` from 640px to 192px in `apps/web/src/components/threadSidebarWidth.ts`.

**Why:** Allow dragging the sidebar much wider while keeping a sliver of the chat visible.
