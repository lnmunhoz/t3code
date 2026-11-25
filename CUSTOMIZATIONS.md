# Customizations

A running history of every change made to this custom version of T3 Code, newest first. See the "This is a custom fork" section in [AGENTS.md](AGENTS.md) for how to add entries.

Each entry: date, title, what changed, and why.

---

## 2026-11-25 — T3 Dev's "Open in" editor button opens files locally

**What:** Before it starts the app, the T3 Dev launcher now links Stable's `~/.t3/userdata/environment-id` into `~/.t3/t3-dev/userdata/environment-id`. The desktop app reads that file to learn which environment is "this computer" (`apps/desktop/src/ipc/methods/localEnvironment.ts`). T3 Dev never runs its own server, so the file was missing. That made the client treat Stable's server, a saved backend at `127.0.0.1:3773`, as a remote machine, and `resolveRemoteOpenState` (`apps/web/src/remoteOpen.ts`) found no SSH route to it. No TypeScript changes. The proper fix would be for the client to count a saved backend at a localhost address in the desktop app as this computer; I chose this launcher-only fix instead. Reinstall with `vp run install:mac-launcher`. Key file: `scripts/install-mac-launcher.sh`.

**Why:** "Open in Cursor" was disabled in T3 Dev and showed "No SSH route to Lucas's MacBook Pro", even though everything runs on this Mac.

## 2026-11-25 — T3 Dev shows in Cmd+Tab and the Dock

**What:** Dropped `LSUIElement` from `T3 Dev.app`'s Info.plist, left over from when the launcher only opened a Chrome window. The dev Electron binary runs from a bundle whose `CFBundleExecutable` is a shell script, so macOS can't match it to that bundle. When it checks in while the T3 Dev launcher is still waiting for it, it takes over the launcher's app entry, LSUIElement included, and runs as a UI element: no Cmd+Tab, no Dock icon. Without the key it runs as a normal foreground app under the T3 Dev name and icon. Reinstall with `vp run install:mac-launcher`. Key file: `scripts/install-mac-launcher.sh`.

**Why:** T3 Dev didn't show up in Cmd+Tab app switching, which was confusing.

## 2026-11-24 — T3 Dev opens the Electron desktop app, not a Chrome window

**What:** Replaces the Chrome window from "'T3 Dev' runs this checkout's client against T3 Code Stable's server" below. `~/Applications/T3 Dev.app` now starts this checkout's Electron app in dev mode (`T3CODE_PORT_OFFSET=40 vp run dev:desktop --home-dir ~/.t3/t3-dev`, logging to `~/Library/Logs/t3code-dev.log`) with its own Electron profile (`T3CODE_DESKTOP_USER_DATA_NAME=t3code-t3-dev`, not `t3code-dev`, which plain `vp run dev:desktop` uses) and its local environment turned off (`~/.t3/t3-dev/userdata/desktop-settings.json`), so it never starts a server. On first open it adds T3 Code Stable's server (`http://127.0.0.1:3773`) as a saved backend: it mints a token with `~/.t3/bin/t3 pair` and hands a `t3code-dev://pair` link to the running app, which asks once to confirm the host (marker `~/.t3/t3-dev/userdata/paired-stable`; delete it to pair again). Opening T3 Dev again brings the window forward. It still starts Stable if its server is down. It won't start while another `vp run dev:desktop` runs in this checkout, because the two share the checkout's dev Electron bundle and lock. The dev launcher's fallback environment now carries `T3CODE_DESKTOP_USER_DATA_NAME`, so a relaunch outside the dev runner lands on the same profile. No TypeScript changes: Electron with the local environment off, plus a saved remote backend, is an existing mode. Key files: `scripts/install-mac-launcher.sh`, `apps/desktop/scripts/electron-launcher.mjs`.

**Why:** T3 Dev didn't have the Tasks page. Wanted it to be the same app as Stable with all desktop features, just running this checkout's code.

## 2026-11-24 — Sidebar: tree guide lines, subagent status, unread pulse

**What:** Four changes to the project folders in the boring sidebar. (1) Each thread row under an open folder draws a 1px tree guide from the folder's icon, with an elbow into the row; the last row ends the line (└). Pure CSS on the row's `<li>` (`sidebar-tree-branch` / `sidebar-tree-last` in `index.css`), hidden while a row is dragged. (2) A thread with background subagents running shows a bot icon and count beside the PR badge. (3) A thread parked on its subagents reads "Waiting on 2 subagents" (or "Waiting on a subagent") instead of "Waiting" in card rows, the status pill and the row's accessible label; narrow folder rows say "Subagents" and leave the count to the badge. Other waits still say "Waiting". (4) A finished thread you haven't opened breathes a green tint three times (0.8s each, CSS only, skipped under reduced motion), then keeps a static green dot on its tree elbow until you open it; settled threads stay quiet. The subagent count comes from the shell's existing `pendingBackgroundTasks` (the same list behind the "Waiting on N subagents" line above the chat), so no server or websocket changes. Key files: `apps/web/src/components/sidebar/SidebarThreadRow.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/Sidebar.logic.ts` (`countPendingSubagents`, status pill), `apps/web/src/index.css`.

**Why:** Wanted to see which threads belong to a project at a glance, see which threads have subagents running and that "Waiting" means waiting on subagents, and have finished-but-unchecked threads gently draw attention so I know to check them.

## 2026-11-24 — The subagent list above the chat is collapsible and lines up with its header

**What:** Follow-up to the entry below. "Waiting on N subagents" is now a toggle with a chevron: the list starts collapsed, a click expands the rows under it, and the open/closed choice is remembered on the device (localStorage `t3code:thread-now-body-open:v1`). The rows' icons now sit in the line's icon column and the titles start where the line's text does. Rows for delegated tasks, which have no turn item to time them, now show elapsed time from the child thread's current run. Key files: `apps/web/src/components/chat/ThreadNow.tsx`, `BackgroundSubagentRows.tsx`.

**Why:** "Please properly align it." "Can you make this subagents section collapsible... basically this can have a collapsible behavior and I can expand seeing the agents under it."

## 2026-11-24 — "Waiting on subagents" above the chat lists each subagent like Lineage

**What:** The line above the composer used to read "Waiting on 2 subagents" followed by a comma-separated list of names. It now keeps a short header and shows one row per subagent underneath, built from the same pieces as the Lineage rows in Thread details: provider icon with a status dot, title, elapsed time, the same hover card, and the same click behaviour (opens that thread). Past about four rows the list scrolls. Details only shows when commands are also running, since the rows already show what it did for subagents. Stop stays. No server or websocket changes. Key files: `apps/web/src/components/chat/BackgroundSubagentRows.tsx` (new), `ThreadActivityBanners.tsx`, `ThreadNow.tsx`, `useThreadLifecycle.tsx`.

**Why:** "Instead of showing this waiting for two subagents like this without much information, can we show it the same way that it shows in the toggle thread details, like with the icon and everything above my chat, that would be much more clear for me what's going on behind the scenes."

## 2026-11-24 — Settings reopens on the last page you were on, uncommitted

**What:** Opening Settings (sidebar, command palette, `/settings`) used to always redirect to General. The settings route now remembers the last settings page this device showed (localStorage key `t3code:last-settings-path:v1`, checked against the known settings pages) and redirects there instead, falling back to General. Hover preloads don't count as a visit. Key files: `apps/web/src/routes/_chat.settings.tsx`, `apps/web/src/components/settings/lastSettingsPath.ts`.

**Why:** "Every time I open T3 Code settings it doesn't save where I was in the settings and this is pretty annoying." Wanted reopening Settings to go back to the same place.

## 2026-11-24 — "T3 Dev" runs this checkout's client against T3 Code Stable's server

**What:** `vp run install:mac-launcher` now installs `~/Applications/T3 Dev.app` in place of "T3 Code Custom" (which it removes; named so that typing "T3 Code" in Spotlight only matches Stable). Opening it starts T3 Code Stable if its server isn't up, starts `vp run dev:web --port 3773` with `T3CODE_PORT_OFFSET=40` (web client on `http://localhost:5773`, logging to `~/Library/Logs/t3code-dev.log`) unless it's already running, and opens it in a Chrome app window with its own profile (`~/Library/Application Support/t3code-dev-web`). The first open, and again every 25 days since sessions last 30, signs that profile in with `~/.t3/bin/t3 pair`. Dev therefore shows the same projects, threads and settings as Stable. Client changes show up live; server changes only reach it after `vp run install:stable`. T3 Code Stable now pins its server to port 3773 (`T3CODE_PORT` in its `LSEnvironment`). Key files: `scripts/install-mac-launcher.sh`, `scripts/install-stable-app.sh`.

**Why:** Three T3 Code apps showed in Spotlight. Wanted just Stable, shown first in Spotlight, and a dev one that runs on its own but points to the same server as Stable. T3 Code (Nightly) was moved to the Trash.

## 2026-11-24 — One checkout: ~/projects/t3code now runs local/custom-nightly

**What:** `~/projects/t3code` and `~/projects/t3code-nightly` were two checkouts of this repo: `local/custom` (on upstream `main`) and `local/custom-nightly` (on upstream Nightly, with every `local/custom` customization plus the Tasks board, browser tabs and Limits work). `~/projects/t3code` was switched to `local/custom-nightly`, the nightly checkout's uncommitted work moved over with it unchanged (through `git stash`; it still fails lint, mostly untranslated copy in the Tasks page, so it stays uncommitted), and the `t3code-nightly` folder was removed. The old checkout's `.t3` is kept at `~/projects/.t3code-old-dev-state-20261124`. Its gitignored dev state (`.t3/`: dev data, `nightly-patch`, `sync-from-nightly.py`, `dev-overrides.json`) moved to `~/projects/t3code/.t3`, and the settings-sync launch agent (`~/Library/LaunchAgents/local.t3code-dev.settings-sync.plist`) points there. The post-commit hook now pushes `local/custom-nightly` to `fork`; `local/custom` stays on `fork` unchanged. Key files: `AGENTS.md`, `.vite-hooks/post-commit`.

**Why:** Two near-identical projects showed up side by side and it wasn't clear which one was in use. Asked to keep the one in use and get rid of the other.

## 2026-11-24 — "T3 Code Stable": an installed build of this checkout, uncommitted

**What:** `vp run install:stable` (`scripts/install-stable-app.sh`) snapshots this checkout as it is (uncommitted work included, through a throwaway git index so the branch is untouched), builds it in `../t3code-nightly-stable-build` as a packaged macOS app and installs it as `~/Applications/T3 Code Stable.app` (bundle id `com.lnmunhoz.t3code.stable`, in Spotlight and Raycast). It uses T3 Code Nightly's data and settings (`~/.t3/userdata`), so only one of the two can be open at a time. Through `LSEnvironment` it gets its own Electron profile (new `T3CODE_DESKTOP_USER_DATA_NAME`; every packaged build otherwise shares `~/Library/Application Support/t3code-v2` and its single-instance lock) and no auto-updates, which would replace it with upstream. The script keeps `CFBundleName`, since Electron finds its helper apps by it. Run it again (Stable quit) to update the app. Key files: `scripts/install-stable-app.sh`, `apps/desktop/src/app/DesktopUserData.ts`, `DesktopConfig.ts`, `DesktopEnvironment.ts`.

**Why:** Wanted the customized build installed as a version that doesn't change when the dev code changes, so dev can be customized and broken while the built one keeps working. Asked for it to show in Spotlight, and to use the same data and configuration as the installed T3 Code rather than starting fresh.

## 2026-11-23 — Pin a browser tab to its project: one live tab in every chat, uncommitted

**What:** A pin button in the browser's address bar, next to the camera button (also in the ⋮ menu as **Pin to project** / **Unpin from project**). A pinned tab stays owned by the chat that opened it, and every other chat in the same project shows that same live page in its panel, marked with a small pin icon.

How it behaves:

- The pin is on the server's tab (`pinned` on the preview snapshot, set through `preview.adjust`). That makes it work on desktop, in the web app and remotely.
- Settling a chat keeps its pinned tabs open (`close` with `keepPinned`).
- Closing the tab in its own chat closes it everywhere. Closing it from another chat unpins it.
- Agents still only see their own chat's tabs.
- Server: `packages/contracts/src/preview.ts`, `apps/server/src/preview/Manager.ts`, `ResourceCleanupService.ts`, `ThreadSettlementService.ts`, with tests.
- Web: `rightPanelStore.ts` (an optional `ownerThreadId` on browser tabs, and `reconcilePinnedSurfaces`), `components/preview/pinnedTabs.ts` and `pinnedTabs.logic.ts`, `ChatView.tsx`, `RightPanelSurfaceContent.tsx`, `RightPanelTabs.tsx`, `useRightPanelSurfaceClose.ts`, `PreviewMoreMenu.tsx`, `PreviewView.tsx`.

**Limits:** Annotations sent from a pinned tab shown in another chat go to the owner chat's composer.

**Why:** "if I'm working on a project and I have a browser open, it would be great if I could pin that browser tab and then every different chat that I go about that project keeps that tab in there so I don't have to reopen again." He chose one shared live tab over reopening the pinned URL in each chat.

---

## 2026-11-23 — Tasks get an In review column; finished agents report back, uncommitted

**What:** Tasks have a new status, `review`: an agent finished the task and it waits for Lucas to look it over. Where it shows:

- an **In review** column on the Board, between In progress and Waiting on you
- an **In review** band in milestone lists
- a segment in the milestone bar and an "in review" count in the summary
- an "In review" badge in the List view
- a "Mark in review" menu item

A chat back at work on a task moves it to In progress until it reports again. The watcher now uses `review`, not `done`, when a reply says the work is finished but not shipped. Files: `taskBoard.logic.ts`, `milestones.logic.ts` (with tests), `KanbanView.tsx`, `MilestoneTaskList.tsx`, `Milestones.tsx`, `TasksPage.tsx`.

Outside this repo (dotfiles 41ef405):

- The `tasks` CLI has `tasks review ID "what was done and how to check it"`. The message is required. It sets the note, links the chat and moves the task to In review.
- The task-board skill tells agents to always finish that way. `done` is for when Lucas says so.
- The planning chat's AGENTS.md makes every launched chat's brief name the task id, run `tasks start` first and finish with `tasks review`.

**Why:** "when we launch sub agents to do these tasks … it doesn't like update the task itself with some message. So I think … a way for the sub agent to send a message there saying that it was done. And then it should go to in review column for me to just take a look."

---

## 2026-11-23 — Browser tabs: your tabs no longer block agents, settling closes tabs, and a Browser tabs page, uncommitted

**What:**

- The server browser's 32-tab cap now counts only tabs that agents opened. Tabs a person opens were never capped, but they used to count toward the 32. They stay open across restarts and the idle cleanup never closes them, so agents in every thread got "Too many server browser tabs are open" while manual opens still worked. The 8-tabs-per-agent cap is unchanged. Files: `apps/server/src/preview/ServerBrowser.ts` (`serverAtTabLimit`), with a test in `ServerBrowser.test.ts`.
- Settling a thread now closes its browser tabs, as it already closed its terminals. Before, only deleting a thread closed them. Files: `apps/server/src/orchestration-v2/ThreadSettlementService.ts` (`cleanUpSettledThread`), with an assertion in its test.
- A new **Browser tabs** page (sidebar link, `/browser-tabs`) lists every open browser tab across all threads, with one section per connected server (the dev app has no primary server of its own). A server on an older build that can't list every tab says so. Tabs are grouped by thread, each showing its title, its URL, who opened it (you or an agent) and when it last changed. You can close one tab, a thread's tabs, or all of them. To support it, `preview.list` returns every thread's tabs when `threadId` is left out. Files: `packages/contracts/src/preview.ts`, `apps/server/src/preview/Manager.ts`, `apps/web/src/components/browserTabs/BrowserTabsPage.tsx`, `apps/web/src/routes/_chat.browser-tabs.tsx`, `SidebarChrome.tsx`, `mainAppLocation.ts`. New strings are keyed in every locale but left in English.

**Why:** Threads refused to use the integrated browser and said too many browsers were open, even though Lucas could still open browsers by hand. Tabs kept piling up because settling a chat never closed them. He wanted one place to see every open tab and close them all.

---

## 2026-11-22 — Task labels, and milestones as a Cello-style list, uncommitted

**What:** Each open milestone on the Milestones tab now lists its tasks the way Cello's milestone page does. The tasks sit in bands for To do, In progress, Waiting on you and Done, each with a count, and a band folds when you click it. Each task is one line:

- a state icon (click it to tick the task off)
- the title, with "› parent" for a subtask, and its note
- a working badge, the subtask count and the chat count
- label chips
- its age

Click the row to open its chat. The groups follow the same rules as the Board, and the counts under the bar match them. Open milestones start expanded.

Tasks now have `labels`: short lowercase tags, kept in the board file. They show as colored chips (the same label always gets the same color) in the milestone list, on Board cards and on List rows. A tag button that appears on hover lets you pick labels you've used or type a new one and press Enter. The `tasks` CLI has `label`, `unlabel`, `labels` and `add --label`, and the task-board skill documents them (dotfiles fefdf25). Files: `TaskLabels.tsx`, `MilestoneTaskList.tsx`, plus `labels` in `taskBoard.logic.ts` with tests.

**Why:** "Why is this UI so basic and doesn't show the tasks properly?" and "For the milestone, you can show it kind of as a list … like in Cello … try to replicate this layout with labels too."

## 2026-11-22 — Project filter on the Tasks page, uncommitted

**What:** A projects button next to the milestone filter on the Tasks tab ("All projects", one project's name, or "N projects"). Its menu copies the Issues page's Projects filter: "Show all", then a checkbox per board project with its favicon, and a search box past 8 projects. It filters the List, the Board, the Now strip, the milestone menu and the Milestones tab. It stores the hidden projects, so a new project shows up on its own; the choice is saved, so it stays after a restart (`ProjectFilterMenu.tsx`, `TasksPage.tsx`).

**Why:** "Can you add a project filter (reuse ui that t3 already has)".

## 2026-11-22 — Tick tasks off from the Board, uncommitted

**What:** Each Board card has a checkbox like the List's. Ticking it marks the task (or subtask) done, and it moves to Done this week. Unticking a card in Done opens it again. The rest of the card still opens its chat. Still no dragging (`KanbanView.tsx`).

**Why:** "from the board allow me to mark stuff as done".

## 2026-11-22 — Board: In progress column replaces Working, uncommitted

**What:** The Board's columns are To do, In progress, Waiting on you, Done this week. In progress holds every started task: a chat works on it now, a chat is linked to it or to one of its subtasks, or one of its subtasks is done. Tasks with a chat running now sit on top with the pulse and the Working badge, and the column header adds "N working now". To do keeps only tasks nobody has touched (`kanbanColumns` in `taskBoard.logic.ts` + test, `KanbanView.tsx`). Also pinned the clock in the flaky "same id on every read" test.

**Why:** "The task tracker should have a "In Progress" column so we know the work that is in progress, right now we have the working column but does not paint the whole picture".

## 2026-11-22 — Board's Done column shows subtasks too, uncommitted

**What:** The Board's Done column also lists subtasks ticked off in the last 7 days, at any depth, with "› parent task" after the project name. A click opens the parent's chat when the subtask has none. Subtasks under a task that is itself done stay out, because that task's card covers them. The other columns still show only each project's top-level tasks (`kanbanColumns` in `taskBoard.logic.ts` + test, `KanbanView.tsx`).

**Why:** "There's some discrepancy with the things that I mark as done and then on the board view I'm not seeing them marked as done there." The Board showed only top-level tasks, so finished subtasks (like 4 of the Trello cards) only showed as "4/10". He picked "Done column only".

## 2026-11-22 — Planning chat beside the Tasks board, with @ tasks, uncommitted

**What:** A Planning chat button (speech bubbles, in the Tasks header) opens a panel beside the board with a real T3 chat: the side chat's embedded `ChatView`, with its composer, model picker and messages. Diffs and shell commands open the chat in the main window. The column resizes from its left edge like the app's side panels (`useResizableWidth` + `RightPanelResizeHandle`: drag, or arrow keys; 320px up to the room the board leaves, width saved) ("I need to be able to resize the side panel same as the main panels").

- **Which chat:** the chat lives in the T3 project "Planning" (`~/home/planning`; made with T3's project API, not in this repo). Its `AGENTS.md` makes the agent a project manager: it keeps the board with the `tasks` command, brainstorms, and writes no code. The panel shows the chat picked last (localStorage), else the newest one in that project.
- **New chat:** a first-message box creates the chat as it sends, copying the model and access of the last planning chat (else of the newest chat). There are also Open in the main window and Hide.
- **@ tasks:** in this chat only (`TaskMentionsContext`), typing @ lists the board's open tasks first: waiting first, then newest, matching text, note, project or milestone. Picking one inserts `[task ID: text]`, and the agent runs `tasks show ID`.
- **Code:** `PlanningChat.tsx`, `taskMentions.logic.ts` (+ test), `taskMentionsContext.ts`, and `useTaskBoardWhen` in `taskBoardStore.ts`. Composer: a `task` item type in `ComposerCommandMenu.tsx`, `useComposerMenuItems.ts` and `ChatComposer.tsx`.

**Why:** "Can we have it in the tasks page also, like a way for me to see the chat? … The chat there is just kind of like focused on project management to manage the tasks and is like to help me to like brainstorm." He picked "Panel on Tasks page". Then: "Also in that chat if I press @ and start typing is aware of the tasks and I can reference tasks".

## 2026-11-22 — Milestones on the Tasks page, uncommitted

**What:** Milestones, built like Cello's (CEL-113, CEL-132). Each board project has its own ordered milestones (name, optional goal and target date, open or closed). Each of the project's direct tasks is in at most one milestone, and subtasks follow their task. They're stored in `tasks.json` as `milestones` on the project and `milestone` (an id) on the task. A watcher "move" to another project takes the task out of its milestone.

- **List:** each project's tasks are grouped under milestone headers with a progress bar, done/total and days left or late, then No milestone. An open milestone has an "Add a task to X…" row. A milestone filter sits next to the sort.
- **Menus:** a task's ⋯ menu has a Milestone submenu (open milestones, No milestone, New milestone…). A project's ⋯ menu has New milestone….
- **Milestones tab** (between List and Questions): only projects that have milestones show ("Only show milestones here for projects that we actually created, otherwise it's gonna be too messy"); a New milestone menu at the top starts one in any project. Each project's milestones as expandable cards with bars, counts, goal, due words and their tasks. Closed ones are folded under "Closed (n)". A milestone menu has Edit, Move up or down, Close or Reopen, and Delete (its tasks stay).
- **Close prompt:** when every task in an open milestone is done, "All done: close X?" appears. Only he closes or reopens.
- **Board:** cards show a milestone chip.
- **Code:** logic in `milestones.logic.ts` (+ test), parsing in `taskBoard.logic.ts`, views in `Milestones.tsx`.
- **Agents:** the `tasks` command (dotfiles skill `task-board`) gained `milestones`, `milestone show|add|edit`, `move ID --milestone`, and `add --milestone`. It refuses to close or reopen.

**Why:** "Can you look at cello and see how we built the milestones feature there, I would like to add this here so we can organize stuff better." He picked "All of it".

## 2026-11-22 — A chat can move from a project into one inside its folder, uncommitted

**What:** `t3_thread_move` (`moveToProject` in `apps/server/src/project/ScratchThreadPromotion.ts`) used to move only No project chats. It now also moves a chat into a project whose folder is inside its own project's folder (home `~/home` into ThaiLookup `~/home/ThaiLookup`), as long as the chat isn't on a worktree (a move drops the worktree). Same move as before: a chat moving itself moves when its turn ends, and its next turn runs in the new folder. Tool description updated; test in `runtimeLayer.test.ts` ("refuses a thread outside No project" now also checks the move inside). The trigger is a rule in `~/home/AGENTS.md` (dotfiles): a chat started in home moves itself once the task is clearly for ThaiLookup, RentaBus or box.

**Why:** "I might start chats from ~/home, but then in t3 would it be possible to automatically switch to the project that I am working on?" He picked "the agent moves itself".

## 2026-11-22 — Tasks page: which machine a task runs on, and project icons, uncommitted

**What:** The Working badge adds the machine icon and name ("Working 12m · [server] box", tooltip "Running on box") when the chat runs in an environment other than this Mac, with the same `EnvironmentMachineIcon` and environment label the sidebar's thread hover card uses (`RemoteMachine` in `TaskWorking.tsx`). Board projects now show their app project's icon (the sidebar's `ProjectFavicon`: favicon, monogram, emoji or icon) beside the name in the project headers, the Now strip, Board cards and the Done today list. A board project is matched to the app project with the same name, else to the app project most of its chats run in (name first, because chats often run in a broader project like home) (`boardProjectKeys` in `taskBoard.logic.ts` + test; `TaskProjectIcon.tsx` with a context set once by `TasksPage`).

**Why:** "If a task is running not on my mac please show that visually as well (running on the box or something), follow same ui patterns that t3 already uses." And: "t3 also has these icons, can we show them next to the project name so we kinda keep the same look when displaying project (good for ux)." Then, for the name-first match: "For ThaiLookup can you set the logo to be the light svg magnifier". That logo is set on a new Nightly project "ThaiLookup" (root `~/home/ThaiLookup`, favicon `thailookup-brand/logo/chosen/parts/logo-r8-p-semi-m5-plain-icon-light.svg`), made through T3's project API, not in this repo.

## 2026-11-22 — Board (kanban) layout of tasks, uncommitted

**What:** A **List / Board** switch in the List view (next to the sort menu; Board hides the Now strip and the sort, and keeps the Show and date filters): Board shows every project's tasks (the project's direct children) as cards in four columns: To do, Working, Waiting on you, Done this week. A card sits where its status and its chats put it: Waiting on you when it or a subtask needs you, Working when a chat is on it or a subtask, Done for tasks finished in the last 7 days. Newest first; Working by when the run started. Cards show the task, note (two lines), project, subtasks done/total, a chat icon, the Working badge with its pulse, and the age; a click opens the chat (the working one first). Read-only: no dragging, since only agents and the watcher move tasks. Logic: `kanbanColumns` in `taskBoard.logic.ts` (+ test); view: `apps/web/src/components/tasks/KanbanView.tsx`. The page goes to its widest width for this view, and the columns scroll sideways in a narrow Tasks window.

**Why:** "Can we also have a kanban view of the tasks? but is a kanban view that only agents can move tasks around, so don't need to implement drag and drop for me." Then: "there should be a toggle list/board view in the main page, instead of a new page".

## 2026-11-22 — Working tasks pulse softly, uncommitted

**What:** A task row a chat is working on (List view and the Now strip) has a faint blue background that pulses (`WorkingGlow` in `apps/web/src/components/tasks/TaskWorking.tsx`: `bg-info/10` with `motion-safe:animate-pulse`, behind the text via `relative isolate` on the row and `-z-10` on the layer). It is off when the system asks for reduced motion.

**Why:** "Make the tasks that are working have like a flashing animation like subtle in the whole row."

## 2026-11-22 — Limits view: Claude account quotas from the local proxy, uncommitted

**What:** A third view on the Tasks page header, **Limits**, next to List and Questions (main window and the Tasks window). It shows each Claude account connected to EasyCLIProxyAPI as a small card in a grid (two across, three on wide windows) with its full email, 5-hour and weekly use as bars (green, amber from 70%, red from 90%), "resets in 2h 14m · 12:10 PM", an "As of 4m ago" line (greyed after 30 minutes, since the proxy only learns limits from real requests), and chips for Off / Cooling down / At its limit / Extra usage on. It re-reads every 5 minutes while open, on window focus, and from a Refresh button, and keeps the last good read if the proxy stops answering. An **All accounts** card on top adds them up as one pool (the proxy spreads requests over them): combined use is each account's use weighted by its plan size from claude.com/pricing (checked 2026-11-22: Pro 1; Max 5 in both windows; Ultra 10 weekly and no 5-hour limit, so it is left out of the 5-hour pool), shown as "73% left", "across 2 accounts" with the soonest reset; accounts that are off are left out, and a window that has reset since counts as empty. The proxy doesn't know plans, so each card has a **Set plan** chip (kept in localStorage by email, shared with the Tasks window); an account without one counts as the average of those set, or all equal when none are. Every number and bar shows what's **left** (bars drain from full to empty), at the user's request. The header shows that total on every view ("5h 73% · Week 73% left", gauge amber from 70%, red from 90%), and a click opens Limits. The desktop main process reads the proxy's port and `management-secret-key` from `~/Library/Application Support/com.cpa.gui/config.toml` on each read and does one GET to `http://127.0.0.1:<port>/v0/management/auth-files`; the key never reaches the page. Key files: `apps/desktop/src/ipc/methods/proxyLimits.ts` (+ test), `apps/web/src/components/tasks/LimitsView.tsx`, `proxyLimitsStore.ts`, `proxyLimits.logic.ts` (+ test), `taskBoard.readProxyLimits` in `packages/contracts/src/ipc.ts` and `preload.ts`.

**Why:** "I have like three accounts using the proxy right now and it would be great if there was a view in this same kind of … limits view that shows like the quota for each of the accounts … and then like refreshes automatically every five minutes or something so I can like keep track of my limits." Chosen: proxy data only (no calls to Anthropic with the account tokens), full emails, key read automatically.

## 2026-11-22 — Tasks in its own window, and live Working / Waiting on tasks

**What:** A pop-out button (picture-in-picture icon, "Open in its own window") in the Tasks page header opens the Tasks page in a separate desktop window you can keep beside the app or on another screen; pressing it again focuses that window. The window (`apps/desktop/src/window/TasksPopoutWindow.ts`, `openPopout` on `desktopBridge.taskBoard`) loads the same app address as the main window with `?popout=tasks#/tasks`, sandboxed with the same preload, no webviews, links to other sites open in the browser. IPC trusts it like the main window (`isTasksPopoutSender` in the `DesktopIpc.layer` guard). In that mode the web app (`components/tasks/tasksPopout.ts`, `isTasksPopout`) starts only appearance, theme and i18n services (`appInit.tsx`) and renders just the route without the sidebar or the app's dialog hosts (`routes/__root.tsx`), so the watcher, notifications, announcements and migrations still run once, in the main window. The popout hides the watcher switch, usage and Fill in, re-reads the question log every 20 s and on focus, and a chat chip or chat title there brings the main window forward on that chat (`showThread` → `onOpenThread`, `startTasksPopoutThreadOpening`). Tasks also show live chat state (`TaskWorking.tsx`, `taskLiveStates` in `taskBoard.logic.ts`): a task whose chat is running shows **Working 12m** like the sidebar, its chat chip turns blue, and the project header adds "· 1 working". A chat linked to several open tasks counts for the one changed last. "Waiting on you" now follows the chat: it hides while the chat works or once you've written in the chat since the watcher set it, and shows whenever the chat is asking you something (question card or approval). The List view has a **Show** switch, All tasks / Working N / Waiting on you N (`filterTasks` with the live state; works together with the date filter), and a **Sort** menu: Board order, Last updated (last change or tick-off) or Newest added (`sortTasks`: every level newest first, a parent or project as new as the newest task inside it). Both are remembered while the app runs. Hand moves (Alt+↑/↓) still change the board order. A **Now** strip tops the List view (`NowStrip.tsx`, `nowTasks`): every task a chat is working on or waiting on you for, across projects, waiting first, each with its project and latest note; a click opens the chat. The header shows **N done today** (`tasksDoneSince`), which opens the list of today's ticked-off tasks with their times. In the Tasks window a pin button keeps it above other apps (`setAlwaysOnTop(…, "floating")`, `pinPopout`), and the window reopens at its last place and size if that still fits a display, and pinned if it was (`~/.config/t3code-tasks/popout-window.json`). When a task turns to waiting on you, the main window (`startWaitingAlerts` in `taskLive.ts`) has the Dock icon bounce once if you're in another app (`alertWaiting`; other platforms flash the Tasks window), and the Now strip highlights that row for 30 s. The Dock badge's count is left to unread chats.

**Why:** "Is it possible to have like this tasks view … that I can like detach and then it works as a like an external view from the app so I just look at that". Then: "If the chat is currently working on that task, can we also display here so we know what the tasks are that are actively being worked on?" Then: "That waiting for you maybe is not so accurate right now." Then: a filter to "show only things that are working" and to sort "by last updated or by … created". Then picked all four suggested improvements: the Now strip, keep on top with a remembered size, Done today, and a waiting alert.

## 2026-11-22 — Questions and decisions log on the Tasks page

**What:** The watcher also keeps a history of what you asked and decided. In the same Haiku call that updates the board, it writes one entry per prompt, plus one per answer you gave to an agent's question card (read from the run's answered `user_input_request` items, `questionAnswer`). Each entry has a kind (question, request or decision), the board project, the chat, a short "what was asked" and a short answer. Entries are appended to `~/.config/t3code-tasks/questions.jsonl` (trimmed to the newest 20,000 past 8 MB) through `readQuestions` / `appendQuestions` on `desktopBridge.taskBoard`; the desktop side shares one log handler with the usage log. The Tasks page header has a **List | Questions** switch: Questions shows the entries grouped by project, then chat (the chat title opens it), newest first, four per chat with "Show more", with search, an All / Questions / Decisions / Requests filter, and a date filter under it: Today (since local midnight), 3 days, 7 days or All, or **Pick dates** for a calendar day range (both days included; `periodWindow`, `dayRangeWindow`), with the entry count on the right. The chosen dates are remembered while the app runs, per view. The List view has the same filter (shared `DateFilter.tsx`: `useDateFilter`, `DateFilterBar`): a task shows when it was added, changed or ticked off in the window (`taskActivityAt`, `filterTasksByWindow` in `taskBoard.logic.ts`), its parents stay around it, projects with nothing left hide, done tasks in the window show, and the count reads "N tasks changed". The chat side panel's Tasks tab shows the project's questions and decisions under its tasks, the open chat's first. Prompts are logged as they finish while "Watch my chats" is on. **Fill in** (Questions view) backfills the last 4 hours, 24 hours or 7 days: it reads each recent chat's transcript in order (`exchangesFromTranscript`: each typed prompt with the question-card answers and the last agent message before the next prompt), skips prompts the log already has and a running chat's unfinished last prompt, and summarizes them 6 per Haiku call with `"ops":[]`, so the board is untouched. Its calls show in Watcher usage. Transcript times are Effect 4 DateTimes (`epochMilliseconds`), read by `timeMs`. The live watcher also takes the reply from the transcript, since the shell's latest message can be a tool card. Key files: `apps/web/src/components/tasks/taskQuestions.logic.ts` (with tests), `taskQuestionsStore.ts`, `QuestionsView.tsx`, `taskWatcher.ts` (`latestExchange`), `taskBoard.logic.ts` (prompt asks for `"log"`, `TurnDecision`, "Decided:" lines), `TasksPage.tsx`, `apps/desktop/src/ipc/methods/taskBoard.ts`, `apps/desktop/src/ipc/channels.ts`, `apps/desktop/src/preload.ts`, `packages/contracts/src/ipc.ts`.

**Why:** "Track all the questions that I ask and then the answer in a summarized way … per project … question per session", because they lose track of what they asked. Then: "Question and decisions, when I make a decision and stuff like that also should show." Then a filter for today or three days, "and then also have like a calendar range filter that I can choose what I want to see." Then: "I need the same kind of filter in the tasks page."

## 2026-11-22 — Task watcher files work under the real project

**What:** The watcher no longer files tasks under the T3 project a chat was started in. Each turn now tells Haiku the T3 folder only as a hint (with its path), plus the project-level folders the prompt and reply mention (`~/home/ThaiLookup/src/a.ts` counts as `~/home/ThaiLookup`), and the prompt explains that a folder holding many projects (like `home` or `box`) is not a project. The `add` op names the real project (`"project":"ThaiLookup"`), matched to an existing project ignoring case and punctuation, or made new with a short name. A new `move` op lets the watcher put a misfiled open task under the right project (never a done task or a project), and `add` can start a task as waiting. Key files: `apps/web/src/components/tasks/taskBoard.logic.ts` (`mentionedFolders`, `shortenHome`, `ensureProject`, prompt, tests), `taskWatcher.ts`.

**Why:** "It puts a lot of projects into the box and then in the home … home is not a project, home is just home … we shouldn't follow exactly what the T3 projects are, we should have our own kind of tree to follow."

## 2026-11-22 — Project and chat name above the composer

**What:** In a chat, a small label sits just above the message box: the project's icon and name, then the chat's title (`RentaBus › Working on Trello Tasks`). It has a blurred background so it stays readable over the conversation, and it is hidden on the new-thread screen, which already names the project. When a task on the Tasks board links the chat, the label shows that task's board project instead, as plain text without an icon, since the T3 project is often a container folder like `home` (`projectForThread` in `taskBoard.logic.ts`: the newest open linked task wins). A list button at the label's left (desktop app only) opens a **Tasks** tab in the right panel with just that project's open tasks, editable as on the Tasks page, plus **Open all tasks**; if no task links the chat, it says so. The tab is a singleton right-panel surface (`kind: "tasks"`). Key files: `apps/web/src/components/chat/ComposerThreadLabel.tsx`, `apps/web/src/components/ChatView.tsx`, `apps/web/src/components/tasks/TasksPage.tsx` (`ThreadTasksPanel`), `apps/web/src/rightPanelStore.ts`, `apps/web/src/closedViewStore.ts`, `apps/web/src/components/RightPanelTabs.tsx`, `apps/web/src/components/chat/RightPanelSurfaceContent.tsx`.

**Why:** "When I'm in the chat I cannot see the actual project name … I'm always kind of messaging the wrong chat sometimes." Asked for the sidebar row's project and title just above the chat box. Then: a tasks button there that "opens as a side panel only the tasks for that project … that references that chat".

## 2026-11-22 — Tasks page: watcher cost log and task dates

**What:** The Tasks page header shows what the watcher has cost today (`$0.0008 today`); clicking it opens **Watcher usage**: cost, calls and tokens for today, the last 7 days and all time, then each call with its time, chats, tokens in and out, cost and result (changes, no change, or failed with the error). The desktop `classify` call now returns the tokens, cost and duration the Claude CLI reports (`DesktopTaskClassifyResult`), and each call is appended to `~/.config/t3code-tasks/usage.jsonl` (trimmed to the newest 2,000 lines past 1 MB) through `readUsage` / `appendUsage` on `desktopBridge.taskBoard`. Each task shows its age on the far right of its row, like the sidebar's thread times: when it last changed ("25m", "3h", "2d"), or when it was ticked done; amber when an open task hasn't changed for 3 days, and a hover shows the full dates ("Added today 3:32 PM, updated 2h ago"). Editing a task's text or clearing its note now counts as an update. Key files: `apps/web/src/components/tasks/taskUsage.logic.ts` (with tests), `taskUsageStore.ts`, `taskWatcher.ts`, `TasksPage.tsx`, `taskBoard.logic.ts` (`isStaleTask`, `wasUpdatedSinceAdded`), `apps/desktop/src/ipc/methods/taskBoard.ts`, `packages/contracts/src/ipc.ts`.

**Why:** Wanted to see the tokens and cost of every call the watcher makes, to understand what it costs, and dates on each task "to know how fresh they are".

## 2026-11-22 — Tasks page with a cheap chat watcher

**What:** A **Tasks** page (sidebar footer, next to Usage; route `/tasks`, desktop app only) shows a nested list like Dynalist: top-level items are projects, everything under them is a task or sub-task with a checkbox, an optional one-line note, a "Waiting on you" badge, and chips that open the chats it came from. Type to rename, Enter adds a task below, Tab and Shift+Tab nest and un-nest, Alt+↑/↓ move, ⌘Enter ticks done, Backspace on an empty task deletes it. Done items stay struck through for a day, then hide (the ··· menu shows them all). The board is one JSON file, `~/.config/t3code-tasks/tasks.json`, so any agent can fill it in: the ··· menu's **Copy a prompt for an agent** gives the file's path and shape to paste into a chat. Parsing is forgiving (bare strings, missing ids and dates), and items without an id get a stable one from their place and text. The desktop main process reads, writes (atomically) and watches the file, so an agent's edit shows at once (`apps/desktop/src/ipc/methods/taskBoard.ts`, `desktopBridge.taskBoard`). **Watch my chats** (`taskWatcherEnabled`, device-local, off by default, switch in the page header) watches every chat on every connected environment: when a prompt's turn finishes, it takes the prompt (from the thread transcript) and the final reply, batches turns 20 s apart with calls at least a minute apart, and asks Claude Haiku through the `claude` CLI (no tools, no MCP, no settings, no saved session; about $0.001 a call) for a few ops: add a task, link a chat, set active / waiting / done, or a short note. It never deletes, never reopens a done item, never marks a project done, and skips background-work wakes, delegated child threads and archived threads. Chats with no project go under "Other". Key files: `apps/web/src/components/tasks/` (`taskBoard.logic.ts` with tests, `taskBoardStore.ts`, `taskWatcher.ts`, `TasksPage.tsx`), `apps/web/src/appInit.tsx`, `apps/web/src/components/sidebar/SidebarChrome.tsx`, `packages/contracts/src/ipc.ts`, `packages/contracts/src/settings.ts`.

**Why:** "I have ADHD … I'm prompting all these different chats … that progress of what I'm working on can be kind of scattered, and then I don't really know when I finish something that I started." Wanted a lean page in T3 to see current tasks, nested like Dynalist, that a model watching prompts and replies keeps up to date "without also spending too many tokens", that can be ticked off by hand, and that a chat can fill in on request.

## 2026-11-16 — Music bars along the window's left edge

**What:** A new Labs setting, **Music bars** (`musicBarsEnabled`, device-local, off by default). While it is on and Spotify or Apple Music plays, a 32px strip of live bars runs down the left edge of the desktop window: a 40-band spectrum, bass in the middle and treble toward the top and bottom, in the foreground colour at 60% on a square-root curve so quiet tracks still move. T3 Code measures the music itself: `native/audio-meter/main.swift` is a small macOS helper that taps only the Spotify and Apple Music processes through a private Core Audio process tap (macOS 14.2+) and prints one spectrum every 20 ms; no audio is stored. `dev:desktop` builds it with `swiftc` (`apps/desktop/scripts/build-audio-meter.mjs`); the desktop main process runs it only while the window subscribes and restarts it when a player launches or quits (`apps/desktop/src/ipc/methods/musicLevels.ts`); the helper keeps its tap device stopped while no player is sending audio out (Core Audio's per-process `IsRunningOutput`), because a running tap costs coreaudiod about a third of a core even while the music is paused, and the preload exposes `subscribeMusicLevels`. The page writes each reading straight into CSS variables, so 50 readings a second never re-render React, and hides the strip after 400 ms without one (paused). Under the switch, like Focus Dot's **Animated bars**: **Position** (Left edge, or Bottom: bars rising along the bottom of the window), **Sensitivity**, **Reach**, **Visibility**, **Falloff** (peaks land at once, falloff only softens the way down) and **Bar density**, with **Reset to defaults** (`musicBars` in client settings, `MusicBarsSettings` / `DEFAULT_MUSIC_BARS` in contracts, `apps/web/src/components/settings/MusicBarsSettings.tsx`). macOS asks once to allow System Audio Recording for T3 Code. Not shown in a browser, on mobile, or under reduced motion; packaged release builds don't include the helper yet. Key files: those above, `apps/web/src/components/MusicBars.tsx`, `apps/desktop/src/preload.ts`, `packages/contracts/src/ipc.ts`, `packages/contracts/src/settings.ts`, `apps/web/src/components/settings/LabsSettingsPanel.tsx`.

**Why:** Wanted the music bars Focus Dot (`~/projects/focus-extension`) shows from Spotify inside T3 Code too, with T3 Code on its own rather than reading from Focus Dot ("otherwise this is gonna get messy"). A first version read Focus Dot's local server; it was replaced the same day and Focus Dot's change reverted. Then asked for Focus Dot's display options, plus a choice between the left edge and the bottom of the window.

## 2026-11-16 — Background progress follows a command's log file

**What:** When a background Bash command sends its output to a file (`npm run test:linux > linux.log 2>&1`, `>>`, `&>` or `| tee`), the progress reader now also reads that file, beside the task's own output, which stays empty until such a command ends. Key files: `apps/server/src/orchestration-v2/BackgroundProgress.ts` (`backgroundCommandOutputFiles`), `Adapters/ClaudeTaskOutputTail.ts` (`watchClaudeTaskProgress` takes `outputFiles`), `Adapters/ClaudeAdapterV2.ts` (resolves them against the thread's folder), `docs/user/providers-claude.md`.

**Why:** After the merge, a chat running the focus-extension container tests still showed "Waiting on 2 commands" with no bar. The run was printing `::progress:: 45/104 E2E`, but the agent had written its output to its own log, so T3 Code read nothing. Asked to debug why.

## 2026-11-16 — Background command progress merged into local/custom

**What:** Merged `feat/background-command-progress` (the two 2026-11-14 entries below: background command progress above the chat, and reading Playwright and Node test counts). The work had stayed on its own branch, so the running app never had it.

**Why:** New chats ran the container tests and the band above the chat showed no progress, though focus-extension already prints `::progress::` lines. Asked to merge it.

## 2026-11-14 — dev:desktop rebuilds the server in the background; a button restarts onto it

**What:** `dev:desktop` used to build `apps/server/dist` only at startup, so server changes needed a manual rebuild, and that rebuild restarted the app the moment `bin.mjs` changed, sometimes halfway through writing it. Now `apps/desktop/scripts/dev-electron.mjs` runs `vp pack --watch` for the server with `T3CODE_SERVER_DEV_STAGE=1`, which builds into `apps/server/dist-next` (gitignored) and writes a `.complete` marker when a build finishes. It no longer restarts the app when `dist` changes. The desktop main process checks the marker and, when the staged build differs from the running one, tells the page, which shows a restart icon button in the sidebar footer ("Restart to load server changes" on hover). Clicking it asks for confirmation, then writes a request file; `dev-electron` stops the app, swaps `dist-next` in as `dist` (keeping the web client), and starts the app again. Key files: `apps/desktop/scripts/dev-electron.mjs`, `apps/server/vite.config.ts`, `apps/desktop/src/ipc/methods/devServerBuild.ts`, `apps/desktop/src/preload.ts`, `packages/contracts/src/ipc.ts`, `apps/web/src/components/sidebar/SidebarDevServerRestart.tsx`.

**Why:** Server changes didn't show up in the dev app (an agent couldn't see the new `t3_thread_move` tool), and the manual rebuild left the app unable to start. Wanted server changes to rebuild on their own, but the app to restart only when clicked, so running agents aren't cut off.

## 2026-11-14 — Move a No project thread into a project, from an agent or the thread menu

**What:** A new MCP tool, `t3_thread_move`, moves a No project thread into an existing project, conversation included. With no `threadId` it moves the calling thread once that agent's turn has ended: moving ends the live session, and cutting the turn off mid-call left the tool call stuck as "Waiting" and played the failed-turn sound. `continuationPrompt` is queued after the move, so the next turn runs in the project folder. Under it, a server-only `thread.project.move` command points the thread at the project root (`worktreePath` and `branch` cleared) and detaches its live provider sessions with "Workspace changed.", so the next turn resumes the conversation in the new folder. `ScratchThreadPromotion.moveToProject` checks the rules: only a No project thread, only into a real project other than No project, and not while it is working unless it is moving itself. It also moves the thread's scheduled tasks, and running it again is safe. Files in the old scratch folder stay there. The thread menu (the title menu and the sidebar's right-click menu) also has **Move to project**, a submenu of your projects. It is shown for No project threads on servers that advertise `threadMoveToProject`, and it calls the new `projects.moveThread` request. Any move, from the menu or an agent, shows a "Moved to <project>" toast (from `ThreadNotificationCoordinator`, when in-app notifications are on). Mobile does not have it yet. Key files: `apps/server/src/project/ScratchThreadPromotion.ts`, `apps/server/src/orchestration-v2/Orchestrator.ts` (`dispatchThreadMutation`), `apps/server/src/mcp/toolkits/project/tools.ts` and `handlers.ts`, `apps/server/src/ws.ts`, `packages/contracts/src/orchestrationV2.ts`, `packages/contracts/src/rpc.ts`, `apps/web/src/components/threadActionMenu.logic.ts`, `apps/web/src/hooks/useThreadActions.ts`.

**Why:** A thread was started with no project by accident. Asked to move it into the focus-extension project, the agent said T3 can't move a thread between projects and started a new thread with a re-written brief. Wanted the agent to be able to move the thread itself and carry on, without typing the prompt again. After trying it: the move worked, but the sound said the turn failed, a "Waiting · t3_thread_move" row never cleared, and there was no notice that the thread had moved.

## 2026-11-14 — dev:desktop's app quits when its runner dies

**What:** The dev runner passes its PID to `apps/desktop/scripts/dev-electron.mjs` as `T3CODE_DEV_RUNNER_PID`. The watcher checks it every second and, once that PID is gone, shuts down along with its Electron window and server. Before this, killing the runner (a closed agent shell, SIGKILL, or a plain SIGTERM, which `vp` does not pass on to its tasks) left the watcher orphaned. It kept relaunching its own window, which held `~/.t3/dev`, so the next `dev:desktop` server quit with `ServerAlreadyRunningError` (exit 78). Orphaned Vite and `vp pack --watch` processes can still be left behind; they only push the next run to the next free port. Key files: `apps/desktop/scripts/dev-electron.mjs`, `scripts/dev-runner.ts`.

**Why:** `dev:desktop` kept failing to start, and an agent had to be asked to find and kill the leftovers every time. Wanted it to just start.

## 2026-11-14 — "T3 Code Custom" app in Spotlight and Raycast

**What:** `vp run install:mac-launcher` installs `~/Applications/T3 Code Custom.app`, a small launcher with the dev icon that Spotlight and Raycast index like any app. Opening it brings the running dev app forward (`open -b com.t3tools.t3code.dev.t3code`). If the dev app isn't open, it stops an idle dev runner by the PID in its lock file, then starts `vp run dev:desktop` in this checkout, logging to `~/Library/Logs/t3code-custom.log`. Key file: `scripts/install-mac-launcher.sh`.

**Why:** Typing "T3 Code" in Raycast or Spotlight only found the official production build, which isn't used. Wanted this fork to be the one to launch from there.

## 2026-11-12 — Only one dev:desktop runner per checkout

**What:** `vp run dev:desktop` writes its PID to `apps/desktop/.electron-runtime/dev-desktop.pid` (gitignored) and removes it on exit. A second `dev:desktop` on the same checkout now stops right away with an error naming the running runner's PID. It takes over the file when that PID is dead. Key files: `scripts/dev-runner.ts` (`claimDesktopRunnerLock`), `scripts/dev-runner.test.ts`.

**Why:** Agents in other sessions kept starting a second dev desktop on this checkout. Two runners fight: the second app loses the single-instance lock, and each runner's `dev-electron.mjs` kills every dev app of the checkout by name on each rebuild. That made the app steal focus and closed its window. Blocking the second runner was the follow-up chosen after the focus fix.

## 2026-11-12 — A second launch exits cleanly, so dev desktop stops stealing focus

**What:** When T3 Code starts while another copy already holds the single-instance lock, the new copy now exits with code 0 instead of 130 (quit plus an Effect interrupt). The dev runner (`apps/desktop/scripts/dev-electron.mjs`) treats any non-zero exit as a crash and relaunches 120 ms later. So with two `dev:desktop` runners on one checkout, the losing copy relaunched about once a second, forever. Each relaunch fired `second-instance` in the running app, which reveals its window with `app.focus({ steal: true })` on macOS. The logs show about 370 focus grabs in 5 minutes. Key files: `apps/desktop/src/app/DesktopClerk.ts`, `apps/desktop/src/app/DesktopClerk.test.ts`.

**Why:** T3 Code kept taking focus from whatever app was in use and bringing itself to the front after it restarted.

## 2026-11-12 — One "complete" alert per prompt, not per background wake

**What:** When a background job (a command, Monitor, subagent or delegated task) finishes, the agent starts a new "wake" run to react to it. Each wake run used to end with its own "Thread completed" sound, speech, toast and desktop notification, so one prompt could alert two to seven times. Now, once a prompt has alerted, runs started by a notification (finished background work, a restart note) complete quietly until the next prompt. A failure or a question in a wake run still alerts. A completion that was held while the agent waited on background work (`t3_background_wait`) also used to fire the instant the job left the list, a beat before its wake run started. It now waits the existing 5s grace and is dropped when that wake starts, so the wake run's end is the one alert. The server exposes which run a notification started as `latestRunFromNotification` on the thread shell (absent from older servers, which keep the old behavior). Phone pushes through the relay are unchanged. Key files: `apps/web/src/components/ThreadNotificationCoordinator.logic.ts`, `apps/web/src/components/ThreadNotificationCoordinator.tsx`, `apps/server/src/orchestration-v2/ProjectionStore.ts` (`isNotificationRunForShell` and its SQL mirror), `packages/contracts/src/orchestrationV2.ts`.

**Why:** The completion sound triggered two or three times per session. The agent would stop, background things kept running, and when they finished it made the sound again. Wanted the sound to be more accurate about when work is actually done: one sound per prompt.

## 2026-11-14 — Background progress also reads common test runners

**What:** A background command that prints no `::progress::` lines still shows progress when it runs Playwright or Node's built-in test runner. Playwright's list reporter prints its total ("Running 84 tests using 1 worker") and numbers each result, so the band shows "Playwright 12 / 84" with a bar; its line reporter's `[12/84]` works too. Node's runner without a terminal prints TAP, which numbers each top-level result but learns its total last, so the band shows "Tests, 412 done" with no bar. A command's own `::progress::` lines always win. Vitest prints nothing until it finishes when its output is not a terminal, so it is not read. Key files: `apps/server/src/orchestration-v2/BackgroundProgress.ts` (`makeBackgroundProgressReader`), `apps/server/src/orchestration-v2/Adapters/ClaudeTaskOutputTail.ts`, `docs/user/providers-claude.md`.

**Why:** Asked whether the progress bar works for any project that runs a test suite, and chose to have T3 Code read the counts common runners already print, so other projects get it with no setup.

## 2026-11-14 — Background command progress above the chat

**What:** While an agent waits on a background command, the line above the composer ("Waiting · …") can show how far the command has got: a short text such as "Unit tests 412 / 1,484" and a thin bar. A command opts in by printing its own lines, `::progress:: 412/1484 Unit tests` (the count is optional; a bare `::progress::` clears it). For Claude background Bash commands, the server reads the last 8 KB of the task's output file once a second while the task runs and keeps only the newest progress line. That line reaches clients through a new unpersisted subscription, `orchestration.subscribeBackgroundProgress`, the same way prompt suggestions do: no orchestration events, no database writes, and no other output leaves the server. Other providers do not report progress yet. Web and desktop only; mobile's background work sheet is unchanged. Key files: `apps/server/src/orchestration-v2/BackgroundProgress.ts` (line parser), `apps/server/src/orchestration-v2/Adapters/ClaudeTaskOutputTail.ts` (`watchClaudeTaskProgress`), `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`, `apps/server/src/orchestration-v2/ProviderSessionManager.ts` (store and subscription), `background_progress.updated` in `packages/provider-core/src/server/ProviderAdapter.ts`, `packages/contracts/src/orchestrationV2.ts` and `rpc.ts`, `packages/client-runtime/src/state/orchestration.ts`, `apps/web/src/components/chat/ThreadActivityBanners.tsx`, `apps/web/src/components/chat/useBackgroundProgress.ts`, `docs/user/providers-claude.md`.

**Why:** "When the tests are running in the container is there any progress bar that we could see it? I am here in t3code and if I could see the progress of the test in here on top of the chat would be great." The focus-extension container run takes 10+ minutes, and the band only said it was waiting.

## 2026-11-11 — Archive combo plays one sound per thread

**What:** Archiving N threads now plays exactly N sounds. `notification-completion.mp3` strikes twice (about 64 ms apart), so the chime voice now starts at the second strike. The fanfare, three extra notes after the last hit, is replaced by a **Finishing chord** (same `finale` setting): the last hit layers a major chord on its note, played as one sound. Key files: `apps/web/src/archiveComboSound.ts`, `apps/web/src/components/sidebar/SidebarArchiveSuggestion.tsx`, `apps/web/src/components/settings/ArchiveComboSoundSettings.tsx`.

**Why:** Archiving a single thread made several sounds. It should make one sound per archived thread.

## 2026-11-11 — Archive settings live together in Labs

**What:** The idle-threshold setting (**Suggest archiving idle threads** and its hours field) moved from Settings › General to a new **Archiving** section in Settings › Labs, alongside **Archive combo sound**. Settings search now points there, and General's restore-defaults no longer lists it. Key files: `apps/web/src/components/settings/LabsSettingsPanel.tsx`, `apps/web/src/components/settings/SettingsPanels.tsx`, `apps/web/src/components/settings/settingsSearch.ts`, `docs/user/thread-sidebar.md`.

**Why:** Wanted everything about archiving configured in one place, in Labs.

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
