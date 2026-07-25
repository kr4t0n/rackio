import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import type { Footprint } from "@shared/types";
import { Field, TextInput } from "@/board/settings-fields";
import type { AdguardRank, AdguardStats } from "@/lib/api";
import {
  clearAdguardConnection,
  fetchAdguardConnection,
  fetchAdguardStats,
  saveAdguardConnection,
} from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";
import { ActivityChart } from "./Chart";

const configSchema = z.object({});
type AdguardConfig = z.infer<typeof configSchema>;

function useStats() {
  return useQuery({
    queryKey: ["adguard"],
    queryFn: fetchAdguardStats,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}

const number = (value: number | undefined) => (value ?? 0).toLocaleString();

function ShieldMark({ compact }: { compact: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[9px] border border-border bg-[color-mix(in_oklch,var(--surface)_78%,var(--fg)_5%)] ${
        compact ? "h-[25px] w-[25px]" : "h-[29px] w-[29px]"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    </span>
  );
}

function MetricLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[8px] leading-[1.3] tracking-[0.08em] uppercase text-muted">
      {children}
    </span>
  );
}

function RankList({ ranks }: { ranks: AdguardRank[] }) {
  const max = Math.max(...ranks.map((rank) => rank.count), 1);
  return (
    <div className="grid min-h-0 auto-rows-fr gap-1.5">
      {ranks.map((rank) => (
        <div
          key={rank.name}
          className="min-h-0 min-w-0 rounded-[9px] border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_3%)] px-2 py-1.5"
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-[9px] font-[550]">{rank.name}</span>
            <span className="shrink-0 font-mono text-[8px] leading-none font-semibold tabular-nums">
              {rank.count.toLocaleString()}
            </span>
          </div>
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--fg)_10%,transparent)]">
            <span
              className="block h-full rounded-full bg-[color-mix(in_oklch,var(--accent)_70%,var(--fg)_12%)]"
              style={{ width: `${Math.max(6, (rank.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-border bg-[color-mix(in_oklch,var(--bg)_28%,var(--surface)_72%)] p-2.5">
      <div className="mb-1.5 flex min-h-[18px] items-center justify-between gap-2">
        <h2 className="m-0 text-[11px] font-semibold">{title}</h2>
        <span className="font-mono text-[7px] tracking-[0.06em] uppercase text-muted">
          {note}
        </span>
      </div>
      {children}
    </section>
  );
}

function ActivityPanel({
  stats,
  size,
}: {
  stats: AdguardStats;
  size: Footprint;
}) {
  const compact = size !== "big";
  return (
    <section
      className={`grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[14px] border border-border bg-[color-mix(in_oklch,var(--bg)_28%,var(--surface)_72%)] ${
        size === "big" ? "p-3" : "p-2.5"
      }`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <MetricLabel>
            {/* The two-word label wraps and eats height on a narrow board. */}
            <span className="whitespace-nowrap">
              {size === "small" ? "Blocked" : "Blocked requests"}
            </span>
          </MetricLabel>
          <strong
            className={`mt-0.5 block font-display leading-[0.95] font-semibold tracking-[-0.035em] tabular-nums ${
              size === "big"
                ? "text-[clamp(26px,7cqw,36px)]"
                : size === "wide"
                  ? "text-[clamp(21px,5cqw,27px)]"
                  : "text-[clamp(24px,13cqw,32px)]"
            }`}
          >
            {number(stats.blocked)}
          </strong>
          {size === "big" && (
            <span className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[8px] leading-[1.2] text-muted">
              <span>of {number(stats.queries)} queries</span>
              <span>·</span>
              <span>{number(stats.threats)} threats</span>
            </span>
          )}
        </div>
        <div className="shrink-0 rounded-[9px] border border-border px-2 py-1.5 text-right">
          <span
            className={`block font-mono leading-none font-semibold tabular-nums ${
              size === "big" ? "text-[15px]" : "text-[12px]"
            }`}
          >
            {(stats.blockRate ?? 0).toFixed(1)}%
          </span>
          <span className="mt-1 block font-mono text-[7px] leading-none tracking-[0.05em] uppercase text-muted">
            blocked
          </span>
        </div>
      </div>

      {/* min-h-0: without it this grid item sizes to content and the chart
          paints over the stats row below. */}
      <div className={`min-h-0 ${compact ? "mt-1" : "mt-2"}`}>
        <ActivityChart
          values={stats.series ?? []}
          unit={stats.timeUnit ?? "hours"}
          showAxis={size === "big"}
        />
      </div>

      {size !== "wide" && (
        // Hidden on a tight small card, where the headline + chart already
        // fill the tile (container query on the card, which is square).
        <div
          className={`gap-2 ${size === "big" ? "mt-2 flex" : "mt-1.5 hidden @[196px]:flex"}`}
        >
          {[
            { label: "Queries", value: number(stats.queries) },
            { label: "Blocked", value: number(stats.blocked) },
            ...(size === "big"
              ? [
                  { label: "Threats", value: number(stats.threats) },
                  {
                    label: "Avg DNS",
                    value: `${stats.avgProcessingMs ?? 0} ms`,
                  },
                ]
              : []),
          ].map((stat) => (
            <div
              key={stat.label}
              className="min-w-0 flex-1 border-t border-border pt-1.5"
            >
              <MetricLabel>{stat.label}</MetricLabel>
              <span
                className={`mt-0.5 block font-mono leading-none font-semibold tabular-nums ${
                  size === "big" ? "text-[12px]" : "text-[10px]"
                }`}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState({ stats }: { stats?: AdguardStats }) {
  const [state, caption] = !stats
    ? ["Reading stats…", ""]
    : !stats.configured
      ? [
          "Not connected",
          "Open this card's settings (edit mode → gear) to connect AdGuard Home.",
        ]
      : stats.error === "unauthorized"
        ? ["Sign-in failed", "Update the credentials in this card's settings."]
        : stats.error === "not-adguard"
          ? ["Wrong address", "That URL isn't an AdGuard Home API — reconnect in settings."]
          : ["AdGuard unreachable", "The instance didn't answer — is it up?"];
  return (
    <div className="flex h-full min-h-0 flex-col justify-end">
      <p className="m-0 text-[17px] leading-[1.2] tracking-[-0.02em]">{state}</p>
      {caption ? (
        <p className="m-0 mt-1.5 max-w-[32ch] text-xs leading-[1.45] text-muted">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function AdguardCard({ footprint }: CardComponentProps<AdguardConfig>) {
  const query = useStats();
  const stats = query.data;
  const live = Boolean(stats?.configured && !stats.error);
  const compact = footprint !== "big";

  const header = (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <ShieldMark compact={compact} />
        <div className="min-w-0">
          {footprint === "big" && (
            <p className="m-0 mb-px font-mono text-[8px] leading-[1.35] font-[550] tracking-[0.08em] uppercase text-muted">
              Last 24 hours
            </p>
          )}
          <h1
            className={`m-0 font-display font-semibold tracking-[-0.015em] ${
              footprint === "big" ? "text-[20px] leading-[1.05]" : "text-[16px]"
            }`}
          >
            AdGuard
          </h1>
        </div>
      </div>
      {footprint !== "small" && live && (
        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[8px] leading-none tracking-[0.06em] uppercase text-muted">
          <span
            className={`h-[7px] w-[7px] shrink-0 rounded-full ${
              stats?.protectionEnabled === false
                ? "bg-warn shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-warn)_14%,transparent)]"
                : "bg-success shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-success)_14%,transparent)]"
            }`}
          />
          <span>
            {stats?.protectionEnabled === false ? "Paused" : "Protected"}
          </span>
        </span>
      )}
    </header>
  );

  if (!live) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header}
        <EmptyState stats={stats} />
      </div>
    );
  }

  if (footprint === "small") {
    return (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2.5">
        {header}
        <ActivityPanel stats={stats!} size="small" />
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2.5">
        {header}
        <div className="grid min-h-0 grid-cols-[1.12fr_0.88fr] grid-rows-[minmax(0,1fr)] gap-2.5">
          <ActivityPanel stats={stats!} size="wide" />
          <Panel title="Top blocked" note="Domains">
            <RankList ranks={(stats!.topBlockedDomains ?? []).slice(0, 3)} />
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-3.5">
      {header}
      <div className="grid min-h-0 grid-rows-[minmax(150px,1.05fr)_minmax(0,1fr)] gap-2.5">
        <ActivityPanel stats={stats!} size="big" />
        <div className="grid min-h-0 grid-cols-2 gap-2.5">
          <Panel title="Top blocked" note="Domains">
            <RankList ranks={stats!.topBlockedDomains ?? []} />
          </Panel>
          <Panel title="Blocked by client" note="Requests">
            <div className="grid min-h-0 auto-rows-fr">
              {(stats!.topClients ?? []).map((client) => (
                <div
                  key={client.name}
                  className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-0.5 last:border-b-0"
                >
                  <span className="truncate text-[9px]">{client.name}</span>
                  <span className="shrink-0 font-mono text-[8px] leading-none text-muted tabular-nums">
                    {client.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function AdguardSettings(props: CardSettingsProps<AdguardConfig>) {
  void props; // connection is shared server state, not per-card config
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ["adguard-connection"],
    queryFn: fetchAdguardConnection,
    staleTime: 60_000,
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["adguard-connection"] });
    queryClient.invalidateQueries({ queryKey: ["adguard"] });
  };
  const connect = useMutation({
    mutationFn: saveAdguardConnection,
    onSuccess: (result) => {
      if (result.ok) {
        setPassword("");
        invalidate();
      }
    },
  });
  const disconnect = useMutation({
    mutationFn: clearAdguardConnection,
    onSuccess: invalidate,
  });

  const status = connection.data;

  if (status?.source === "env") {
    return (
      <div className="rounded-xl border border-border bg-bg px-3.5 py-3 text-xs leading-[1.5] text-muted">
        Connected to <span className="text-fg">{status.baseUrl}</span> — managed
        by the server environment (ADGUARD_* variables).
      </div>
    );
  }

  if (status?.configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="min-w-0 text-xs leading-[1.5] text-muted">
          Connected to <span className="break-all text-fg">{status.baseUrl}</span>
          {status.user ? <> as {status.user}</> : null}.
        </div>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          className="min-h-9 shrink-0 cursor-pointer rounded-lg border border-border px-3 text-[12px] font-[550] text-muted transition-colors hover:text-danger"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const failure = connect.data?.ok === false ? connect.data.error : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg p-3.5">
      <p className="m-0 text-xs leading-[1.5] text-muted">
        Connect your AdGuard Home. Credentials are checked against the instance,
        then stored on the rackio server — never in the board.
      </p>
      <Field label="AdGuard URL">
        {(id) => (
          <TextInput
            id={id}
            value={baseUrl}
            placeholder="http://192.168.1.2:3000"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        )}
      </Field>
      <Field label="Username">
        {(id) => (
          <TextInput id={id} value={user} onChange={(e) => setUser(e.target.value)} />
        )}
      </Field>
      <Field label="Password">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      {failure ? (
        <p className="m-0 text-xs text-danger">
          {failure === "unauthorized"
            ? "AdGuard rejected those credentials."
            : failure === "not-adguard"
              ? "That URL answered, but not with AdGuard's API — check the address."
              : "Couldn't reach that server — check the URL."}
        </p>
      ) : connect.isError ? (
        <p className="m-0 text-xs text-danger">Connection check failed — try again.</p>
      ) : null}
      <button
        type="button"
        disabled={connect.isPending || !baseUrl.trim()}
        onClick={() =>
          connect.mutate({ baseUrl: baseUrl.trim(), user: user.trim(), password })
        }
        className="min-h-10 cursor-pointer rounded-xl border border-transparent bg-fg px-4 text-[13px] font-[550] tracking-[0.02em] text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
      >
        {connect.isPending ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

export const adguardCard: CardDefinition<AdguardConfig> = {
  type: "adguard",
  name: "AdGuard",
  description: "DNS blocking stats, hourly activity, and top offenders.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "big",
  defaultConfig: {},
  configSchema,
  Component: AdguardCard,
  Settings: AdguardSettings,
};
