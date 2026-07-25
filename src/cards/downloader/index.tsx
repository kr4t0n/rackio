import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import type { Footprint } from "@shared/types";
import { Field, TextInput } from "@/board/settings-fields";
import { Sparkline } from "@/board/Sparkline";
import type {
  DownloaderKind,
  DownloaderStats,
  DownloaderTransfer,
} from "@/lib/api";
import {
  clearDownloaderConnection,
  fetchDownloaderConnection,
  fetchDownloaderStats,
  saveDownloaderConnection,
} from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

/**
 * Downloader card. Unlike the other integrations the connection is per card
 * instance — several of these can sit on the board, each pointing at its own
 * qBittorrent or Transmission.
 */

const configSchema = z.object({});
type DownloaderConfig = z.infer<typeof configSchema>;

function formatRate(bytesPerSecond: number | undefined): string {
  const value = bytesPerSecond ?? 0;
  if (value < 1024) return `${Math.round(value)} B/s`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatEta(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `ETA ${Math.round(seconds)}s`;
  if (seconds < 3600) return `ETA ${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `ETA ${Math.round(seconds / 3600)} h`;
  return `ETA ${Math.round(seconds / 86_400)} d`;
}

const STATE_LABEL: Record<DownloaderTransfer["state"], string> = {
  downloading: "Downloading",
  seeding: "Seeding",
  queued: "Queued",
  paused: "Paused",
  checking: "Checking",
  done: "Complete",
};

/** Progress-bar tint follows the transfer's state, per the design. */
const STATE_BAR: Record<DownloaderTransfer["state"], string> = {
  downloading: "bg-accent",
  seeding: "bg-success",
  queued: "bg-warn",
  paused: "bg-[color-mix(in_oklch,var(--fg)_35%,transparent)]",
  checking: "bg-warn",
  done: "bg-success",
};

function DownloadMark({ compact }: { compact: boolean }) {
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
        className="h-[15px] w-[15px]"
      >
        <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" />
      </svg>
    </span>
  );
}

function MetricLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block font-mono text-[8px] leading-[1.2] tracking-[0.07em] uppercase text-muted">
      {children}
    </span>
  );
}

function Summary({
  stats,
  size,
}: {
  stats: DownloaderStats;
  size: Footprint;
}) {
  const history = stats.history ?? [];
  const ages = stats.historyAges ?? [];
  const metrics = [
    { label: "Down", value: formatRate(stats.downSpeed) },
    { label: "Active", value: String(stats.activeCount ?? 0) },
    ...(size === "big"
      ? [
          { label: "Up", value: formatRate(stats.upSpeed) },
          { label: "Queue", value: String(stats.totalCount ?? 0) },
        ]
      : []),
  ];

  return (
    <section
      aria-label="Client summary"
      className={`grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[14px] border border-border bg-[color-mix(in_oklch,var(--bg)_28%,var(--surface)_72%)] ${
        size === "big" ? "px-3 py-2.5" : "p-2.5"
      }`}
    >
      <div
        className={
          size === "wide"
            ? "min-w-0"
            : "flex min-w-0 items-start justify-between gap-2"
        }
      >
        <p className="m-0 truncate text-[11px] font-semibold">
          {stats.clientName ?? "Client"}
        </p>
        <span
          className={`flex min-w-0 items-center gap-1.5 font-mono text-[8px] leading-[1.2] tracking-[0.03em] text-muted ${
            size === "wide" ? "mt-1" : ""
          }`}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <span className="truncate uppercase">Connected</span>
        </span>
      </div>

      {/* min-h-0 so the chart can shrink instead of pushing the metrics out. */}
      <div className="mt-1.5 min-h-0">
        <Sparkline
          values={history}
          ariaLabel="Download throughput over recent samples. Use arrow keys to inspect points."
          formatValue={(value) => formatRate(value)}
          formatLabel={(index) => {
            const age = ages[index];
            if (age === undefined) return "";
            return age < 5 ? "Now" : `${age}s ago`;
          }}
          emptyLabel="Sampling…"
        />
      </div>

      <div
        className={`mt-1.5 gap-2 ${
          size === "big"
            ? "flex justify-between"
            : size === "wide"
              ? // The wide card's summary column is narrower than the small
                // card's tile — stack until there's room for two columns.
                "grid grid-cols-1 items-end gap-x-2 gap-y-1 @[380px]:grid-cols-2"
              : "grid grid-cols-2 items-end gap-x-2 gap-y-1"
        }`}
      >
        {metrics.map((metric, index) => (
          <div
            key={metric.label}
            // Wide's summary column only fits one metric until the card is
            // roomy; stacking them instead would overflow the panel.
            className={`min-w-0 ${
              size === "wide" && index > 0 ? "hidden @[380px]:block" : ""
            }`}
          >
            <MetricLabel>{metric.label}</MetricLabel>
            <span
              // Rates like "48.9 MB/s" outgrow a half-width column on a
              // narrow board — step the type down until the card is roomy.
              className={`mt-0.5 block truncate font-mono leading-none font-semibold tracking-[-0.03em] tabular-nums ${
                size === "big"
                  ? "text-[15px] @[400px]:text-[17px]"
                  : "text-[11px] @[210px]:text-[13px]"
              }`}
            >
              {metric.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TransferRow({ transfer }: { transfer: DownloaderTransfer }) {
  const eta = formatEta(transfer.eta);
  const speed =
    transfer.state === "seeding" || transfer.state === "done"
      ? `${formatRate(transfer.upSpeed)} up`
      : transfer.state === "queued" || transfer.state === "paused"
        ? STATE_LABEL[transfer.state]
        : formatRate(transfer.downSpeed);
  return (
    // Content is deliberately tight: four rows must fit the big card's queue
    // without the meta line clipping on a narrow board.
    <article className="grid min-h-0 min-w-0 content-center overflow-hidden rounded-[11px] border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_3%)] px-2.5 py-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2.5">
        <span className="truncate text-[10px] leading-[1.2] font-[550]">
          {transfer.name}
        </span>
        <span className="shrink-0 font-mono text-[9px] leading-none font-semibold tabular-nums">
          {transfer.progress}%
        </span>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--fg)_11%,transparent)]">
        <span
          className={`block h-full rounded-full ${STATE_BAR[transfer.state]}`}
          style={{ width: `${transfer.progress}%` }}
        />
      </div>
      <div className="mt-1 flex min-w-0 items-center justify-between gap-2 font-mono text-[8px] leading-[1.15] text-muted">
        <span className="truncate">{speed}</span>
        <span className="truncate">{eta ?? STATE_LABEL[transfer.state]}</span>
      </div>
    </article>
  );
}

function TransferPanel({
  transfers,
  total,
  rows,
}: {
  transfers: DownloaderTransfer[];
  total: number;
  rows: number;
}) {
  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="mb-1.5 flex min-h-[16px] items-center justify-between gap-2.5">
        <h2 className="m-0 text-[11px] font-semibold">Transfers</h2>
        <span className="font-mono text-[8px] leading-none tracking-[0.07em] text-muted uppercase">
          {total} items
        </span>
      </div>
      <div
        className="grid min-h-0 gap-1.5"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {transfers.slice(0, rows).map((transfer) => (
          <TransferRow key={transfer.id} transfer={transfer} />
        ))}
        {transfers.length === 0 && (
          <p className="m-0 flex items-center rounded-[11px] border border-border px-2.5 text-[10px] text-muted">
            Nothing in the queue
          </p>
        )}
      </div>
    </section>
  );
}

function EmptyState({ stats }: { stats?: DownloaderStats }) {
  const [state, caption] = !stats
    ? ["Connecting…", ""]
    : !stats.configured
      ? [
          "Not connected",
          "Open this card's settings (edit mode → gear) to link a torrent client.",
        ]
      : stats.error === "unauthorized"
        ? ["Sign-in failed", "Update the credentials in this card's settings."]
        : stats.error === "not-client"
          ? ["Wrong address", "That URL isn't a qBittorrent or Transmission API."]
          : ["Client unreachable", "The client didn't answer — is it running?"];
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

function DownloaderCard({
  footprint,
  instanceId,
}: CardComponentProps<DownloaderConfig>) {
  const query = useQuery({
    queryKey: ["downloader", instanceId],
    queryFn: () => fetchDownloaderStats(instanceId),
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
  const stats = query.data;
  const live = Boolean(stats?.configured && !stats.error);
  const compact = footprint !== "big";

  const header = (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <DownloadMark compact={compact} />
        <div className="min-w-0">
          {footprint === "big" && (
            <p className="m-0 mb-px font-mono text-[8px] leading-[1.35] font-[550] tracking-[0.08em] uppercase text-muted">
              Transfer queue
            </p>
          )}
          <h1
            className={`m-0 truncate font-display font-semibold tracking-[-0.015em] ${
              footprint === "big" ? "text-[20px] leading-[1.05]" : "text-[16px]"
            }`}
          >
            {live && footprint !== "big" ? (stats!.clientName ?? "Downloader") : "Downloader"}
          </h1>
        </div>
      </div>
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
        <Summary stats={stats!} size="small" />
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2.5">
        {header}
        <div className="grid min-h-0 grid-cols-[minmax(140px,0.8fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-2.5">
          <Summary stats={stats!} size="wide" />
          <TransferPanel
            transfers={stats!.transfers ?? []}
            total={stats!.totalCount ?? 0}
            rows={2}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-3.5">
      {header}
      <div className="grid min-h-0 grid-rows-[minmax(0,0.5fr)_minmax(0,1fr)] gap-2.5">
        <Summary stats={stats!} size="big" />
        <TransferPanel
          transfers={stats!.transfers ?? []}
          total={stats!.totalCount ?? 0}
          rows={4}
        />
      </div>
    </div>
  );
}

function DownloaderSettings({ instanceId }: CardSettingsProps<DownloaderConfig>) {
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ["downloader-connection", instanceId],
    queryFn: () => fetchDownloaderConnection(instanceId),
    staleTime: 30_000,
  });
  const [kind, setKind] = useState<DownloaderKind>("qbittorrent");
  const [baseUrl, setBaseUrl] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["downloader-connection", instanceId] });
    queryClient.invalidateQueries({ queryKey: ["downloader", instanceId] });
  };
  const connect = useMutation({
    mutationFn: (payload: {
      kind: DownloaderKind;
      baseUrl: string;
      user: string;
      password: string;
      label?: string;
    }) => saveDownloaderConnection(instanceId, payload),
    onSuccess: (result) => {
      if (result.ok) {
        setPassword("");
        invalidate();
      }
    },
  });
  const disconnect = useMutation({
    mutationFn: () => clearDownloaderConnection(instanceId),
    onSuccess: invalidate,
  });

  const status = connection.data;

  if (status?.configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="min-w-0 text-xs leading-[1.5] text-muted">
          {status.kind === "transmission" ? "Transmission" : "qBittorrent"} at{" "}
          <span className="break-all text-fg">{status.baseUrl}</span>
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
        Each downloader card connects to its own client. Credentials are checked,
        then stored on the rackio server — never in the board.
      </p>
      <div>
        <p className="m-0 mb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted">
          Client
        </p>
        <div
          className="flex gap-[3px] rounded-xl border border-border bg-bg p-[3px]"
          role="group"
          aria-label="Client type"
        >
          {(
            [
              ["qbittorrent", "qBittorrent"],
              ["transmission", "Transmission"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`min-h-10 flex-1 cursor-pointer rounded-[9px] text-[13px] font-[550] tracking-[0.02em] transition-colors ${
                kind === value ? "bg-fg text-bg" : "text-muted hover:text-fg"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      <Field
        label="Client URL"
        hint={
          kind === "qbittorrent"
            ? "The WebUI address, e.g. http://192.168.1.5:8080"
            : "The RPC host, e.g. http://192.168.1.5:9091"
        }
      >
        {(id) => (
          <TextInput
            id={id}
            value={baseUrl}
            placeholder={
              kind === "qbittorrent"
                ? "http://192.168.1.5:8080"
                : "http://192.168.1.5:9091"
            }
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
      <Field label="Card label" hint="Optional — shown instead of the client name.">
        {(id) => (
          <TextInput
            id={id}
            value={label}
            maxLength={40}
            placeholder="Media box"
            onChange={(event) => setLabel(event.target.value)}
          />
        )}
      </Field>
      {failure ? (
        <p className="m-0 text-xs text-danger">
          {failure === "unauthorized"
            ? "The client rejected those credentials."
            : failure === "not-client"
              ? "That URL answered, but not with a torrent client API — check the address and client type."
              : "Couldn't reach that client — check the URL."}
        </p>
      ) : connect.isError ? (
        <p className="m-0 text-xs text-danger">Connection check failed — try again.</p>
      ) : null}
      <button
        type="button"
        disabled={connect.isPending || !baseUrl.trim()}
        onClick={() =>
          connect.mutate({
            kind,
            baseUrl: baseUrl.trim(),
            user: user.trim(),
            password,
            ...(label.trim() ? { label: label.trim() } : {}),
          })
        }
        className="min-h-10 cursor-pointer rounded-xl border border-transparent bg-fg px-4 text-[13px] font-[550] tracking-[0.02em] text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
      >
        {connect.isPending ? "Connecting…" : "Connect"}
      </button>
    </div>
  );
}

export const downloaderCard: CardDefinition<DownloaderConfig> = {
  type: "downloader",
  name: "Downloader",
  description: "Transfer queue and throughput from qBittorrent or Transmission.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "big",
  defaultConfig: {},
  configSchema,
  Component: DownloaderCard,
  Settings: DownloaderSettings,
};
