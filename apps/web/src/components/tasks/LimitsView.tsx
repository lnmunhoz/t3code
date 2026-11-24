import type { DesktopProxyLimitWindow, DesktopProxyLimitsAccount } from "@t3tools/contracts";

import { msg, T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, GaugeIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuItem,
  MenuTrigger,
} from "~/components/ui/menu";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useNowMinute } from "~/hooks/useNowMinute";
import { m, type MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";

import {
  accountState,
  combinedWindow,
  formatAgo,
  formatTimeLeft,
  isStale,
  limitTone,
  PLAN_LABEL,
  planWeights,
  type ClaudePlan,
  type AccountState,
  type CombinedWindow,
} from "./proxyLimits.logic";
import {
  canReadProxyLimits,
  refreshProxyLimits,
  useClaudePlans,
  useProxyLimits,
} from "./proxyLimitsStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

const ERROR_TEXT: Record<NonNullable<ReturnType<typeof useProxyLimits>["error"]>, string> = {
  no_key: msg("Couldn't find the proxy's management key in EasyCLIProxyAPI's settings."),
  proxy_down: msg("The Claude proxy isn't answering. Is EasyCLIProxyAPI running?"),
  unauthorized: msg("The proxy turned down its management key. It may have changed; try Refresh."),
  bad_reply: msg("The proxy sent a reply this view doesn't understand."),
};

const STATE_CHIP: Record<AccountState, { label: string; className: string } | null> = {
  ok: null,
  disabled: {
    label: msg("Off", { $context: "account is turned off" }),
    className: "bg-muted text-muted-foreground",
  },
  cooldown: { label: msg("Cooling down"), className: "bg-warning-surface text-warning-foreground" },
  limited: { label: msg("At its limit"), className: "bg-error-surface text-error-foreground" },
  unavailable: {
    label: msg("Unavailable"),
    className: "bg-warning-surface text-warning-foreground",
  },
};

/**
 * The Tasks page's Limits view: each Claude account on the local proxy with its 5-hour and weekly
 * use, as of the proxy's last request on it. Refreshes every five minutes while open.
 */
export function LimitsView() {
  const gt = useGT();
  const messages = useMessages();
  const { last, error, loading } = useProxyLimits();
  const [plans, setPlan] = useClaudePlans();
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  if (!canReadProxyLimits()) {
    return (
      <p className="text-muted-foreground text-sm">
        <T>Limits are only available in the desktop app.</T>
      </p>
    );
  }
  const accounts = last?.accounts ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground text-xs">
          {last
            ? gt(
                "{count, plural, one {{count} Claude account on the proxy · checked {ago} · every 5 minutes} other {{count} Claude accounts on the proxy · checked {ago} · every 5 minutes}}",
                { count: accounts.length, ago: formatAgo(last.fetchedAt, nowMs) },
              )
            : loading
              ? gt("Reading the proxy…")
              : null}
        </p>
        <Button
          size="compact"
          variant="ghost"
          disabled={loading}
          onClick={() => void refreshProxyLimits()}
        >
          <RefreshIcon refreshing={loading} />
          <T>Refresh</T>
        </Button>
      </div>
      {error ? (
        <p className="rounded-md bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
          {messages(ERROR_TEXT[error])}
          {last ? ` ${gt("Showing the last good read.")}` : ""}
        </p>
      ) : null}
      {last && accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <T>The proxy has no Claude accounts connected.</T>
        </p>
      ) : null}
      {accounts.length > 0 ? <TotalCard accounts={accounts} nowMs={nowMs} plans={plans} /> : null}
      {accounts.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              nowMs={nowMs}
              plan={plans[account.label] ?? null}
              onPlan={(plan) => setPlan(account.label, plan)}
            />
          ))}
        </div>
      ) : null}
      {accounts.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          <T>
            The proxy learns these from Claude's replies, so an account you haven't used lately
            shows older numbers.
          </T>
        </p>
      ) : null}
    </div>
  );
}

function AccountCard({
  account,
  nowMs,
  plan,
  onPlan,
}: {
  account: DesktopProxyLimitsAccount;
  nowMs: number;
  plan: ClaudePlan | null;
  onPlan: (plan: ClaudePlan | null) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const stale = isStale(account, nowMs);
  const state = accountState(account, nowMs);
  const chip = STATE_CHIP[state];
  const cooldownLeft = state === "cooldown" ? formatTimeLeft(account.cooldownUntil, nowMs) : null;
  const seen = formatAgo(account.observedAt, nowMs);
  return (
    <section
      aria-label={account.label}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-2.5",
        state === "disabled" && "opacity-60",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <h2 className="min-w-0 flex-1 truncate font-medium text-xs">{account.label}</h2>
        <PlanMenu plan={plan} onPlan={onPlan} />
        {account.overage === "allowed" ? (
          <span className="shrink-0 rounded-full bg-info/15 px-1.5 text-2xs text-info-foreground">
            <T>Extra usage</T>
          </span>
        ) : null}
        {chip ? (
          <span className={cn("shrink-0 rounded-full px-1.5 text-2xs", chip.className)}>
            {messages(chip.label)}
            {cooldownLeft ? ` · ${cooldownLeft}` : ""}
          </span>
        ) : null}
      </div>
      <div className={cn("flex flex-col gap-1.5", stale && "opacity-50")}>
        <LimitBar label={gt("5-hour")} window={account.fiveHour} nowMs={nowMs} />
        <LimitBar label={gt("Weekly")} window={account.sevenDay} nowMs={nowMs} />
      </div>
      <p className="truncate text-2xs text-muted-foreground">
        {seen
          ? stale
            ? gt("As of {seen}, not used since", { seen })
            : gt("As of {seen}", { seen })
          : gt("No data yet: not used through the proxy")}
      </p>
    </section>
  );
}

function LimitBar({
  label,
  window,
  nowMs,
}: {
  label: string;
  window: DesktopProxyLimitWindow | null;
  nowMs: number;
}) {
  const gt = useGT();
  const left = window ? formatTimeLeft(window.resetsAt, nowMs) : null;
  return (
    <Meter
      label={label}
      pct={window ? window.pct : null}
      detail={
        left && window?.resetsAt
          ? gt("Resets in {left} · {clock}", { left, clock: resetClock(window.resetsAt, left) })
          : window?.resetsAt
            ? gt("Reset since")
            : null
      }
    />
  );
}

/** "12:10 PM", or "Tue 9:00 AM" when it's days away. */
function resetClock(at: string, left: string): string {
  return new Date(at).toLocaleString([], {
    weekday: left.includes("d") ? "short" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

function Meter({
  label,
  pct: rawPct,
  detail,
}: {
  label: string;
  pct: number | null;
  detail: string | null;
}) {
  const gt = useGT();
  const pct = rawPct === null ? null : Math.min(100, rawPct);
  const tone = pct === null ? null : limitTone(pct);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">
          {pct === null ? gt("no data") : gt("{pct}% left", { pct: Math.round(100 - pct) })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={gt("{label} left", { label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct === null ? undefined : 100 - pct}
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        {pct === null ? null : (
          <div
            className={cn(
              "h-full rounded-full",
              tone === "high" ? "bg-destructive" : tone === "warn" ? "bg-warning" : "bg-success",
            )}
            // What's left: full at the start of a window, draining toward zero.
            style={{ width: `${Math.max(100 - pct, 1)}%` }}
          />
        )}
      </div>
      {detail ? (
        <span className="truncate text-2xs text-muted-foreground tabular-nums">{detail}</span>
      ) : null}
    </div>
  );
}

/** "Across 2 accounts · next reset in 1h 50m". */
function combinedDetail(
  window: CombinedWindow,
  nowMs: number,
  resolve: MessageResolver = m,
): string {
  const count = window.counted;
  const next = formatTimeLeft(window.nextResetAt, nowMs);
  return next
    ? resolve(
        msg(
          "{count, plural, one {Across {count} account · next reset in {next}} other {Across {count} accounts · next reset in {next}}}",
        ),
        { count, next },
      )
    : resolve(
        msg("{count, plural, one {Across {count} account} other {Across {count} accounts}}"),
        { count },
      );
}

/** Every account as one pool, since the proxy spreads your requests over them. */
function TotalCard({
  accounts,
  nowMs,
  plans,
}: {
  accounts: ReadonlyArray<DesktopProxyLimitsAccount>;
  nowMs: number;
  plans: Readonly<Record<string, ClaudePlan>>;
}) {
  const gt = useGT();
  const messages = useMessages();
  const fiveHour = combinedWindow(
    accounts,
    "fiveHour",
    nowMs,
    planWeights(accounts, plans, "fiveHour"),
  );
  const sevenDay = combinedWindow(
    accounts,
    "sevenDay",
    nowMs,
    planWeights(accounts, plans, "sevenDay"),
  );
  const missing = accounts.filter((account) => !account.disabled && !plans[account.label]).length;
  if (!fiveHour && !sevenDay) return null;
  return (
    <section
      aria-label={gt("All accounts")}
      className="flex flex-col gap-2 rounded-lg border p-2.5"
    >
      <div className="flex items-baseline gap-2">
        <h2 className="font-medium text-xs">
          <T>All accounts</T>
        </h2>
        <span className="text-2xs text-muted-foreground">
          {missing === 0
            ? gt("as one pool, weighted by plan")
            : gt(
                "{missing, plural, =1 {as one pool · set the plan on 1 account below for an exact total} other {as one pool · set the plan on {missing} accounts below for an exact total}}",
                { missing },
              )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Meter
          label={gt("5-hour")}
          pct={fiveHour?.pct ?? null}
          detail={fiveHour ? combinedDetail(fiveHour, nowMs, messages) : null}
        />
        <Meter
          label={gt("Weekly")}
          pct={sevenDay?.pct ?? null}
          detail={sevenDay ? combinedDetail(sevenDay, nowMs, messages) : null}
        />
      </div>
    </section>
  );
}

/** "5h 73% · Week 73%" left, in the Tasks header: every account as one pool. A click opens Limits. */
export function LimitsBadge({ onOpen }: { onOpen: () => void }) {
  const gt = useGT();
  const messages = useMessages();
  const { last } = useProxyLimits();
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  const [plans] = useClaudePlans();
  const accounts = last?.accounts ?? [];
  const fiveHour = combinedWindow(
    accounts,
    "fiveHour",
    nowMs,
    planWeights(accounts, plans, "fiveHour"),
  );
  const sevenDay = combinedWindow(
    accounts,
    "sevenDay",
    nowMs,
    planWeights(accounts, plans, "sevenDay"),
  );
  if (!fiveHour && !sevenDay) return null;
  const tone = limitTone(Math.max(fiveHour?.pct ?? 0, sevenDay?.pct ?? 0));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="compact"
            variant="ghost"
            aria-label={gt("Claude limits")}
            onClick={onOpen}
          />
        }
      >
        <GaugeIcon
          className={cn(
            tone === "high" ? "text-destructive" : tone === "warn" ? "text-warning" : undefined,
          )}
        />
        <span className="tabular-nums">
          {[
            fiveHour ? `5h ${Math.round(100 - fiveHour.pct)}%` : null,
            sevenDay ? `Week ${Math.round(100 - sevenDay.pct)}%` : null,
          ]
            .filter(Boolean)
            .join(" · ")}{" "}
          left
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <div className="flex flex-col gap-0.5 tabular-nums">
          <span className="font-medium">
            <T>Left across all accounts</T>
          </span>
          {fiveHour ? (
            <span>
              {gt("5-hour: {pct}% left.", { pct: Math.round(100 - fiveHour.pct) })}{" "}
              {combinedDetail(fiveHour, nowMs, messages)}
            </span>
          ) : null}
          {sevenDay ? (
            <span>
              {gt("Weekly: {pct}% left.", { pct: Math.round(100 - sevenDay.pct) })}{" "}
              {combinedDetail(sevenDay, nowMs, messages)}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/** The account's plan, which sizes it in the total. */
function PlanMenu({
  plan,
  onPlan,
}: {
  plan: ClaudePlan | null;
  onPlan: (plan: ClaudePlan | null) => void;
}) {
  const gt = useGT();
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={gt("Plan", { $context: "subscription plan" })}
            className={cn(
              "flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 text-2xs hover:bg-accent/60",
              plan ? "text-foreground" : "text-muted-foreground",
            )}
          />
        }
      >
        {plan ? PLAN_LABEL[plan] : gt("Set plan")}
        <ChevronDownIcon aria-hidden className="size-3" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={plan ?? ""}
          onValueChange={(value) => {
            if (value === "pro" || value === "max" || value === "ultra") onPlan(value);
          }}
        >
          {(Object.keys(PLAN_LABEL) as ClaudePlan[]).map((value) => (
            <MenuRadioItem key={value} value={value} closeOnClick>
              {PLAN_LABEL[value]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {plan ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => onPlan(null)}>
              <T>Clear</T>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
