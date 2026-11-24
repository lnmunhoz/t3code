import { msg, T, useGT, useMessages } from "gt-react";
import { ChevronRightIcon, HistoryIcon, MessageSquareIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatRelativeTime } from "~/timestampFormat";

import { projectKey } from "./taskBoard.logic";
import {
  filterQuestions,
  groupQuestions,
  type QuestionEntry,
  type QuestionKind,
  type QuestionProjectGroup,
  type QuestionThreadGroup,
} from "./taskQuestions.logic";
import { DateFilterBar, useDateFilter } from "./DateFilter";
import { useTaskQuestions } from "./taskQuestionsStore";
import { formatUsd } from "./taskUsage.logic";
import { isTasksPopout, useOpenTaskThread } from "./tasksPopout";
import { backfillQuestions } from "./taskWatcher";

type KindFilter = QuestionKind | "all";

const KIND_FILTERS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: "all", label: msg("All") },
  { value: "question", label: msg("Questions") },
  { value: "decision", label: msg("Decisions") },
  { value: "request", label: msg("Requests") },
];

const KIND_LABEL: Record<QuestionKind, string> = {
  question: msg("Question"),
  decision: msg("Decision"),
  request: msg("Request"),
};

// A chat shows its newest few entries until you ask for the rest.
const ENTRIES_PER_CHAT = 4;

/**
 * The Tasks page's Questions view: what you asked, requested and decided in every chat, each with
 * a short answer, grouped by project and then chat, newest first.
 */
export function QuestionsView() {
  const gt = useGT();
  const messages = useMessages();
  const { entries, loaded } = useTaskQuestions();
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const dateFilter = useDateFilter("questions");
  const shown = filterQuestions(entries, kind, search, dateFilter.timeWindow);
  const groups = groupQuestions(shown);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="min-w-48 flex-1">
          <InputGroupAddon>
            <SearchIcon aria-hidden className="size-3.5" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            size="sm"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={gt("Search questions, answers and chats")}
            aria-label={gt("Search questions")}
          />
        </InputGroup>
        <ToggleGroup
          aria-label={gt("Kind", { $context: "filter by type of entry" })}
          variant="segmented"
          value={[kind]}
          onValueChange={(next) => {
            const value = next[0] as KindFilter | undefined;
            if (value) setKind(value);
          }}
        >
          {KIND_FILTERS.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {messages(option.label)}
            </Toggle>
          ))}
        </ToggleGroup>
        {/* The backfill needs the watcher, which runs in the main window. */}
        {isTasksPopout ? null : <BackfillMenu />}
      </div>
      <div className="-mt-2">
        <DateFilterBar
          filter={dateFilter}
          count={gt("{count, plural, one {{count} entry} other {{count} entries}}", {
            count: shown.length,
          })}
        />
      </div>
      {loaded && entries.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-lg border border-dashed p-6 text-sm">
          <p className="font-medium">
            <T>No questions yet</T>
          </p>
          <p className="text-muted-foreground">
            <T>
              With &ldquo;Watch my chats&rdquo; on, each prompt you send, and each choice you make
              when an agent asks you something, shows up here with a short answer once the chat
              replies.
            </T>
          </p>
        </div>
      ) : null}
      {entries.length > 0 && groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <T>Nothing matches.</T>
        </p>
      ) : null}
      {groups.map((group) => (
        <ProjectQuestionsSection key={group.project} group={group} />
      ))}
    </div>
  );
}

const BACKFILL_WINDOWS: ReadonlyArray<{ label: string; hours: number }> = [
  { label: msg("Last 4 hours"), hours: 4 },
  { label: msg("Last 24 hours"), hours: 24 },
  { label: msg("Last 7 days"), hours: 24 * 7 },
];

/** Fills the log from chats' past runs (ones it doesn't have yet), then says what it cost. */
function BackfillMenu() {
  const gt = useGT();
  const messages = useMessages();
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const run = (hours: number) => {
    setRunning(true);
    setStatus(gt("Reading chats…"));
    void backfillQuestions(hours * 60 * 60 * 1000, (done, total) =>
      setStatus(
        total === 0
          ? gt("Nothing new to log")
          : gt("Summarizing {done} of {total} prompts…", { done, total }),
      ),
    )
      .then((result) =>
        setStatus(
          !result.ready
            ? gt("The watcher isn't running in this window")
            : result.runs === 0
              ? result.read < result.chats
                ? gt(
                    "{chats, plural, one {Nothing new in {chats} chat ({unread} couldn't be read)} other {Nothing new in {chats} chats ({unread} couldn't be read)}}",
                    { chats: result.chats, unread: result.chats - result.read },
                  )
                : gt(
                    "{chats, plural, one {Nothing new in {chats} chat} other {Nothing new in {chats} chats}}",
                    { chats: result.chats },
                  )
              : result.failed > 0
                ? gt(
                    "{failed, plural, one {Added {entries} from {runs} prompts for {cost}, {failed} call failed} other {Added {entries} from {runs} prompts for {cost}, {failed} calls failed}}",
                    {
                      entries: result.entries,
                      runs: result.runs,
                      cost: formatUsd(result.costUsd),
                      failed: result.failed,
                    },
                  )
                : gt("Added {entries} from {runs} prompts for {cost}", {
                    entries: result.entries,
                    runs: result.runs,
                    cost: formatUsd(result.costUsd),
                  }),
        ),
      )
      .catch(() => setStatus(gt("The backfill failed")))
      .finally(() => setRunning(false));
  };
  return (
    <div className="flex items-center gap-2">
      {status ? <span className="text-muted-foreground text-xs">{status}</span> : null}
      <Menu>
        <MenuTrigger
          disabled={running}
          render={<Button size="compact" variant="ghost" aria-label={gt("Fill in past chats")} />}
        >
          <HistoryIcon />
          <T>Fill in</T>
        </MenuTrigger>
        <MenuPopup align="end">
          {BACKFILL_WINDOWS.map((window) => (
            <MenuItem key={window.hours} onClick={() => run(window.hours)}>
              {messages(window.label)}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

function ProjectQuestionsSection({ group }: { group: QuestionProjectGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        className="flex items-center gap-2 text-start"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <ChevronRightIcon
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            !collapsed && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-semibold text-base">{group.project}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{group.count}</span>
      </button>
      {collapsed ? null : (
        <div className="flex flex-col gap-3 ps-6">
          {group.threads.map((thread) => (
            <ChatQuestions key={`${thread.environmentId}:${thread.threadId}`} thread={thread} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One chat's entries under its title, which opens the chat. */
function ChatQuestions({ thread }: { thread: QuestionThreadGroup }) {
  const gt = useGT();
  const openThread = useOpenTaskThread();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? thread.entries : thread.entries.slice(0, ENTRIES_PER_CHAT);
  const hidden = thread.entries.length - shown.length;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        disabled={!thread.threadId}
        onClick={() => openThread(thread.environmentId, thread.threadId)}
        className="flex min-w-0 items-center gap-1.5 self-start rounded px-1 py-0.5 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
      >
        <MessageSquareIcon className="size-3 shrink-0" />
        <span className="truncate">{thread.threadTitle || gt("Untitled chat")}</span>
      </button>
      <div className="flex flex-col">
        {shown.map((entry) => (
          <QuestionRow key={`${entry.at}-${entry.kind}-${entry.question}`} entry={entry} />
        ))}
      </div>
      {hidden > 0 || expanded ? (
        <Button
          size="compact"
          variant="ghost-muted"
          className="self-start"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? gt("Show fewer") : gt("Show {hidden} more", { hidden })}
        </Button>
      ) : null}
    </div>
  );
}

function QuestionRow({ entry }: { entry: QuestionEntry }) {
  return (
    <div className="flex items-start gap-2 rounded-md px-1 py-1.5 hover:bg-accent/40">
      <KindBadge kind={entry.kind} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">{entry.question}</span>
        {entry.answer ? (
          <span className="text-muted-foreground text-xs leading-relaxed">{entry.answer}</span>
        ) : null}
      </div>
      <EntryAge at={entry.at} />
    </div>
  );
}

function KindBadge({ kind }: { kind: QuestionKind }) {
  const messages = useMessages();
  return (
    <span
      className={cn(
        "mt-0.5 w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-2xs",
        kind === "decision" && "bg-warning-surface text-warning-foreground",
        kind === "question" && "bg-accent text-info-foreground",
        kind === "request" && "bg-muted text-muted-foreground",
      )}
    >
      {messages(KIND_LABEL[kind])}
    </span>
  );
}

function EntryAge({ at }: { at: string }) {
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  const relative = formatRelativeTime(at, nowMs);
  const short = relative ? (relative.suffix ? relative.value : "now") : "";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex h-5 w-9 shrink-0 cursor-default items-center justify-end text-muted-foreground text-xs tabular-nums" />
        }
      >
        {short}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {new Date(at).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The side panel's history for one board project: its chats' questions and decisions, newest
 * first, the open chat's first.
 */
export function ProjectQuestions(props: {
  project: string;
  environmentId: string;
  threadId: string;
}) {
  const { entries } = useTaskQuestions();
  const key = projectKey(props.project);
  const group = groupQuestions(entries.filter((entry) => projectKey(entry.project) === key))[0];
  if (!group) return null;
  const isOpenChat = (thread: QuestionThreadGroup) =>
    thread.threadId === props.threadId && thread.environmentId === props.environmentId;
  const threads = [
    ...group.threads.filter(isOpenChat),
    ...group.threads.filter((t) => !isOpenChat(t)),
  ];
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-medium text-sm">
        <T>Questions and decisions</T>
        <span className="text-muted-foreground text-xs tabular-nums">{group.count}</span>
      </h3>
      <div className="flex flex-col gap-3">
        {threads.map((thread) => (
          <ChatQuestions key={`${thread.environmentId}:${thread.threadId}`} thread={thread} />
        ))}
      </div>
    </section>
  );
}
