import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Field, TextInput } from "@/board/settings-fields";
import type { PlexItem, PlexState } from "@/lib/api";
import {
  clearPlexConnection,
  fetchPlexConnection,
  fetchPlexState,
  plexArtUrl,
  savePlexConnection,
} from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({});
type PlexConfig = z.infer<typeof configSchema>;

function usePlex() {
  return useQuery({
    queryKey: ["plex"],
    queryFn: fetchPlexState,
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}

function PlayGlyph() {
  return (
    <span
      aria-hidden="true"
      className="grid h-[25px] w-[25px] shrink-0 place-items-center rounded-full border border-[color-mix(in_oklch,var(--fg)_32%,transparent)] bg-[color-mix(in_oklch,var(--bg)_46%,transparent)] backdrop-blur-md @[380px]:h-[29px] @[380px]:w-[29px]"
    >
      <svg viewBox="0 0 24 24" className="ml-px h-3 w-3 fill-current">
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span
      className={`block overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--fg)_16%,transparent)] ${className}`}
    >
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${Math.max(2, value)}%` }}
      />
    </span>
  );
}

/** The hero: full-bleed art, gradient shade, title and progress over it. */
function Feature({
  item,
  size,
}: {
  item: PlexItem;
  size: "small" | "wide" | "big";
}) {
  const art = item.artPath ? plexArtUrl(item.artPath, 960, 540) : null;
  const body = (
    <>
      {art ? (
        <img
          src={art}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
        />
      ) : null}
      <span className="absolute inset-0 bg-[linear-gradient(to_top,color-mix(in_oklch,var(--bg)_94%,transparent)_0%,color-mix(in_oklch,var(--bg)_42%,transparent)_48%,transparent_76%)]" />
      <span
        className={`absolute inset-x-3 bottom-3 z-1 min-w-0 ${size === "big" ? "" : "inset-x-2.5 bottom-2.5"}`}
      >
        <span className="mb-1 block font-mono text-[8px] leading-[1.3] font-semibold tracking-[0.09em] uppercase">
          {item.kind === "recent" ? "Recently added" : "Continue watching"}
        </span>
        <span
          className={`block truncate font-display font-semibold tracking-[-0.025em] ${
            size === "big"
              ? "text-[clamp(19px,4.5cqw,27px)] leading-[1.02]"
              : size === "small"
                ? "text-[clamp(17px,10cqw,22px)] leading-[1.05]"
                : "text-[clamp(15px,3.6cqw,20px)] leading-[1.05]"
          }`}
        >
          {item.showTitle ?? item.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-[7px] text-[color-mix(in_oklch,var(--fg)_76%,transparent)]">
          <PlayGlyph />
          <span
            className={`truncate leading-[1.3] ${size === "big" ? "text-[10px]" : "text-[9px]"}`}
          >
            {item.detail || item.title}
          </span>
        </span>
        {item.kind === "watching" && (
          <ProgressBar
            value={item.progress}
            className={`mt-2 h-[3px] w-[min(230px,76%)]`}
          />
        )}
      </span>
    </>
  );

  const frame = `group relative block h-full min-h-0 w-full overflow-hidden rounded-[14px] border border-border bg-bg text-left text-fg ${
    size === "big" ? "rounded-[17px]" : ""
  }`;
  return item.webUrl ? (
    <a
      href={item.webUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${item.showTitle ?? item.title} in Plex`}
      className={`${frame} no-underline`}
    >
      {body}
    </a>
  ) : (
    <span className={frame}>{body}</span>
  );
}

/** Queue tiles: poster on top (big) or beside the copy (wide). */
function QueueItem({ item, layout }: { item: PlexItem; layout: "stacked" | "row" }) {
  const poster = item.posterPath
    ? plexArtUrl(item.posterPath, layout === "row" ? 170 : 400, layout === "row" ? 190 : 300)
    : null;
  const inner = (
    <>
      <span className="relative min-h-0 overflow-hidden bg-[color-mix(in_oklch,var(--fg)_8%,transparent)]">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : null}
        {item.kind === "recent" && (
          <span className="absolute top-1 left-1 rounded-[4px] bg-[color-mix(in_oklch,var(--accent)_88%,var(--bg))] px-1 py-px font-mono text-[7px] leading-[1.4] font-semibold tracking-[0.08em] text-bg uppercase">
            New
          </span>
        )}
      </span>
      <span className="min-w-0 self-center px-2 py-1.5">
        <span className="block truncate text-[10px] font-semibold">
          {item.showTitle ?? item.title}
        </span>
        <span className="mt-[3px] block truncate font-mono text-[8px] leading-[1.2] text-muted">
          {item.detail}
        </span>
        {item.kind === "watching" && (
          <ProgressBar value={item.progress} className="mt-1.5 h-0.5" />
        )}
      </span>
    </>
  );
  const frame =
    layout === "row"
      ? "grid min-h-0 min-w-0 grid-cols-[54px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-[9px] border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_3%)] text-left text-fg"
      : "grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-[12px] border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_3%)] text-left text-fg";
  return item.webUrl ? (
    <a
      href={item.webUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${item.showTitle ?? item.title} in Plex`}
      className={`${frame} no-underline transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_76%,var(--fg)_9%)]`}
    >
      {inner}
    </a>
  ) : (
    <span className={frame}>{inner}</span>
  );
}

/** Name the queue for what's in it — the hero already says which it is. */
function railLabel(rail: PlexItem[]): string {
  return rail.every((item) => item.kind === "recent")
    ? "Recently added"
    : "Up next";
}

function EmptyState({ state }: { state?: PlexState }) {
  const [title, caption] = !state
    ? ["Reaching the server…", ""]
    : !state.configured
      ? [
          "Not connected",
          "Open this card's settings (edit mode → gear) to link your Plex server.",
        ]
      : state.error === "unauthorized"
        ? ["Token rejected", "Update the Plex token in this card's settings."]
        : state.error === "not-plex"
          ? ["Wrong address", "That URL didn't answer as a Plex server."]
          : state.error === "unreachable"
            ? ["Server unreachable", "Plex didn't answer — is it running?"]
            : ["Nothing to show", "No library activity yet — start watching something."];
  return (
    <div className="flex h-full min-h-0 flex-col justify-end">
      <p className="m-0 text-[17px] leading-[1.2] tracking-[-0.02em]">{title}</p>
      {caption ? (
        <p className="m-0 mt-1.5 max-w-[32ch] text-xs leading-[1.45] text-muted">
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function PlexCard({ footprint }: CardComponentProps<PlexConfig>) {
  const query = usePlex();
  const state = query.data;
  // Most servers have exactly one thing on deck, which would leave the queue
  // rail empty — recently-added backfills it (and carries the hero if nothing
  // is in progress at all).
  const items = [...(state?.items ?? []), ...(state?.recent ?? [])];
  const live = Boolean(state?.configured && !state.error && items.length > 0);
  const compact = footprint !== "big";

  const header = (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`grid shrink-0 place-items-center rounded-[9px] border border-border bg-[color-mix(in_oklch,var(--surface)_78%,var(--fg)_5%)] font-display font-semibold ${
            compact ? "h-[25px] w-[25px] text-[12px]" : "h-[28px] w-[28px] text-[13px]"
          }`}
        >
          P
        </span>
        <div className="min-w-0">
          {footprint === "big" && (
            <p className="m-0 mb-px font-mono text-[8px] leading-[1.35] font-[550] tracking-[0.08em] uppercase text-muted">
              Media library
            </p>
          )}
          <h1
            className={`m-0 truncate font-display font-semibold tracking-[-0.015em] ${
              footprint === "big" ? "text-[20px] leading-[1.05]" : "text-[16px]"
            }`}
          >
            Plex
          </h1>
        </div>
      </div>
      {footprint !== "small" && live && (
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[9px] leading-[1.2] tracking-[0.03em] text-muted">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_16%,transparent)]" />
          <span className="truncate uppercase">{state?.serverName}</span>
        </span>
      )}
    </header>
  );

  if (!live) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header}
        <EmptyState state={state} />
      </div>
    );
  }

  if (footprint === "small") {
    return (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2.5">
        {header}
        <Feature item={items[0]} size="small" />
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-2.5">
        {header}
        <div className="grid min-h-0 grid-cols-[minmax(0,1.2fr)_minmax(158px,0.8fr)] grid-rows-[minmax(0,1fr)] gap-2.5">
          <Feature item={items[0]} size="wide" />
          <div className="grid min-h-0 grid-rows-2 gap-1.5">
            {items.slice(1, 3).map((item) => (
              <QueueItem key={item.id} item={item} layout="row" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const rail = items.slice(1, 4);
  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-3.5">
      {header}
      <div className="grid min-h-0 grid-rows-[minmax(0,1.38fr)_minmax(0,1fr)] gap-3">
        <Feature item={items[0]} size="big" />
        <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
          <div className="mb-1.5 flex min-h-[20px] items-center justify-between gap-2.5">
            <h2 className="m-0 text-[11px] font-semibold">{railLabel(rail)}</h2>
            <span className="font-mono text-[8px] tracking-[0.07em] text-muted uppercase">
              {items.length} titles
            </span>
          </div>
          <div className="grid min-h-0 grid-cols-3 gap-2">
            {rail.map((item) => (
              <QueueItem key={item.id} item={item} layout="stacked" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PlexSettings(props: CardSettingsProps<PlexConfig>) {
  void props; // connection is shared server state, not per-card config
  const queryClient = useQueryClient();
  const connection = useQuery({
    queryKey: ["plex-connection"],
    queryFn: fetchPlexConnection,
    staleTime: 60_000,
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["plex-connection"] });
    queryClient.invalidateQueries({ queryKey: ["plex"] });
  };
  const connect = useMutation({
    mutationFn: savePlexConnection,
    onSuccess: (result) => {
      if (result.ok) {
        setToken("");
        invalidate();
      }
    },
  });
  const disconnect = useMutation({
    mutationFn: clearPlexConnection,
    onSuccess: invalidate,
  });

  const status = connection.data;

  if (status?.configured) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <div className="min-w-0 text-xs leading-[1.5] text-muted">
          Connected to <span className="break-all text-fg">{status.baseUrl}</span>.
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
        Connect your Plex server. The token is checked against it, then stored
        on the rackio server — never in the board.
      </p>
      <Field label="Server URL">
        {(id) => (
          <TextInput
            id={id}
            value={baseUrl}
            placeholder="http://192.168.1.10:32400"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Plex token"
        hint="Plex Web → any item → ⋯ → Get Info → View XML; copy X-Plex-Token from the URL."
      >
        {(id) => (
          <TextInput
            id={id}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        )}
      </Field>
      <Field label="Card label" hint="Optional — shown instead of the server name.">
        {(id) => (
          <TextInput
            id={id}
            value={label}
            maxLength={40}
            placeholder="Rackio media"
            onChange={(event) => setLabel(event.target.value)}
          />
        )}
      </Field>
      {failure ? (
        <p className="m-0 text-xs text-danger">
          {failure === "unauthorized"
            ? "Plex rejected that token."
            : failure === "not-plex"
              ? "That URL answered, but not as a Plex server — check the address."
              : "Couldn't reach that server — check the URL."}
        </p>
      ) : connect.isError ? (
        <p className="m-0 text-xs text-danger">Connection check failed — try again.</p>
      ) : null}
      <button
        type="button"
        disabled={connect.isPending || !baseUrl.trim() || !token.trim()}
        onClick={() =>
          connect.mutate({
            baseUrl: baseUrl.trim(),
            token: token.trim(),
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

export const plexCard: CardDefinition<PlexConfig> = {
  type: "plex",
  name: "Plex",
  description: "Continue watching from your Plex media server.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "big",
  defaultConfig: {},
  configSchema,
  Component: PlexCard,
  Settings: PlexSettings,
};
