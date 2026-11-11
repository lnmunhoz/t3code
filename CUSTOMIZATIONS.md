# Customizations

A running history of every change made to this custom version of T3 Code, newest first. See the "This is a custom fork" section in [AGENTS.md](AGENTS.md) for how to add entries.

Each entry: date, title, what changed, and why.

---

## 2026-11-11 — Idle thread housekeeping with a combo sound

**What:** A card at the top of the sidebar (styled like the unsent-draft card) offers to archive threads idle for 12 hours or more. Idle means no messages or runs, an un-settle, or a snooze wake since then. Pinned, snoozed, auto-settle-disabled, and open threads are never suggested, nor anything working or waiting on you; settled threads are. **Review** lists them most idle first; the card's X, or a row's X, keeps those threads until new activity makes them idle again (kept list in localStorage). **Archive all** archives them one by one: each hit plays a chime that climbs a musical scale like a game combo, a ×N counter pops, rows check off with a "+1" and fold away, and a fanfare closes it. Undo groups them as usual. The idle threshold is a device setting in Settings › General (1–720 hours, or off). The sound is tunable in Settings › Labs › Archive combo sound: on/off, voice (the completion chime pitched up, a coin, or a pop), volume, scale, speed, fanfare, and a Preview button. Web and desktop only; mobile is unchanged. Key files: `apps/web/src/components/sidebar/idleArchiveSuggestions.ts` (candidate rules, tested), `apps/web/src/components/sidebar/SidebarArchiveSuggestion.tsx`, `apps/web/src/archiveComboSound.ts`, `apps/web/src/components/settings/ArchiveSuggestionSettings.tsx`, `apps/web/src/components/settings/ArchiveComboSoundSettings.tsx`, `packages/contracts/src/settings.ts` (`sidebarArchiveSuggestionHours`, `archiveComboSound`), one element in `apps/web/src/components/Sidebar.tsx`.

**Why:** Wanted automatic housekeeping so old sessions get cleaned up as I go: suggestions at the top of the sidebar to archive sessions idle for more than 12 hours, with a configurable time. Archiving them should feel like a fun points game, with a completed sound that climbs higher on each archive like a video game combo, a smooth effect, and the sound customizable from Labs.

## 2026-11-10 — Plain-text questions show as Awaiting Input

**What:** When a run's final reply asks you something in plain text (no structured question card), the thread now shows **Awaiting Input** in the sidebar and on mobile, like a structured question. It gets the pulsing attention dot and comes first in the `mod+shift+u` jump. It clears when you open the thread or reply. After each completed run, a server reactor reads the final reply. A free text check decides clear cases: a trailing `?`, or a question followed by a list of options. Only unclear endings (a `?` mid-paragraph, or phrases like "let me know which…", "please confirm…") go to the configured text-generation model (Haiku by default), through the existing generic prompt-in, text-out operation, so every provider supports it. Polite closers such as "let me know if you need anything else" are ignored. Agent-driven threads (subagents, delegated tasks) are never flagged. The server records a verdict for every finished run, and the web client holds the "Thread completed" notification until that verdict arrives (at most 30s). So a question announces only "Input needed", not both. Servers without this feature never send the field, so their notifications are not held. Key files: `apps/server/src/orchestration-v2/replyQuestion.ts` (text check, prompt), `apps/server/src/orchestration-v2/ReplyQuestionReactor.ts`, the server-only `thread.reply-check.record` command and `replyCheck` field in `packages/contracts/src/orchestrationV2.ts`, `apps/server/src/orchestration-v2/Orchestrator.ts`, `packages/client-runtime/src/state/models.ts` (`asksUserQuestion`, `replyCheckPending`), `apps/web/src/components/ThreadNotificationCoordinator.logic.ts` (held completions), `apps/web/src/components/Sidebar.logic.ts`, `apps/mobile/src/features/threads/threadListV2.ts`.

**Why:** The status often said "Completed" when the agent had actually ended with a question, so I kept going back into threads and reading the end to find out whether I needed to act. Wanted a cheap model to check the last sentences and make it visible that I need to respond.

## 2026-11-09 — Jump to threads that need you, with a pulsing sidebar dot

**What:** A new `thread.nextAttention` keybinding (`mod+shift+u` by default) opens the next thread that needs you. Threads waiting on input, an approval, a guest request or a usage limit come first, then unseen failures, then finished threads you have not opened. Repeated presses walk that queue. A toast says so when nothing is left. In the desktop app, Settings › General › Notifications › **Jump to threads that need you** records an optional system-wide shortcut (off by default). It brings T3 Code forward from any app and runs the same jump through the existing menu-action channel. Compact and folder sidebar rows that need you show a pulsing amber dot in the left gutter. It uses the existing stepped `status-pulse` animation and stops with reduced motion. Key files: `apps/web/src/components/Sidebar.logic.ts` (`isSidebarAttentionStatus`, `resolveThreadAttentionRank`, `resolveNextAttentionThreadKey`), `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/sidebar/SidebarThreadRow.tsx`, `apps/web/src/components/settings/AttentionShortcutSettings.tsx`, `apps/desktop/src/window/DesktopAttentionShortcut.ts`, `packages/contracts/src/settings.ts` (`attentionGlobalShortcut`), `packages/contracts/src/keybindings.ts`, `packages/shared/src/keybindings.ts`.

**Why:** Wanted one shortcut to get to every session that is waiting on me or finished recently, without hunting through the sidebar, plus an attention-grabbing indicator on sidebar rows that need me.

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
