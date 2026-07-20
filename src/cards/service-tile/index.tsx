import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { Footprint } from "@shared/types";
import { ExternalLinkIcon } from "@/app/icons";
import { Field, TextInput, Toggle } from "@/board/settings-fields";
import { pingService } from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({
  name: z.string().max(40),
  url: z.string().max(200),
  ping: z.boolean(),
});

type ServiceTileConfig = z.infer<typeof configSchema>;

type Status = "unknown" | "checking" | "up" | "down";

function useServiceStatus(url: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["ping", url],
    queryFn: () => pingService(url),
    enabled: enabled && url.length > 0,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 0,
  });
  const status: Status = !enabled
    ? "unknown"
    : query.isPending
      ? "checking"
      : query.data?.up
        ? "up"
        : "down";
  return { status, latencyMs: query.data?.latencyMs };
}

const STATUS_DOT: Record<Status, string> = {
  unknown: "bg-[color-mix(in_oklch,var(--fg)_25%,transparent)]",
  checking:
    "bg-warn shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-warn)_14%,transparent)] animate-pulse",
  up: "bg-success shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-success)_14%,transparent)]",
  down: "bg-danger shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-danger)_14%,transparent)]",
};

const STATUS_LABEL: Record<Status, string> = {
  unknown: "Not monitored",
  checking: "Checking…",
  up: "Online",
  down: "Unreachable",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Monogram({ name, footprint }: { name: string; footprint: Footprint }) {
  const size = footprint === "big" ? "h-14 w-14 text-[22px]" : "h-10 w-10 text-[15px]";
  return (
    <span
      aria-hidden="true"
      className={`grid ${size} shrink-0 place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--fg)_7%,transparent)] font-display font-semibold tracking-[-0.01em]`}
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function StatusLine({
  status,
  latencyMs,
  className = "",
}: {
  status: Status;
  latencyMs?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
      <span className="text-xs text-muted">
        {STATUS_LABEL[status]}
        {status === "up" && latencyMs !== undefined ? (
          <span className="font-mono tabular-nums"> · {latencyMs} ms</span>
        ) : null}
      </span>
    </span>
  );
}

function OpenButton({ url, name }: { url: string; name: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${name}`}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_4%)] text-fg transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_76%,var(--fg)_10%)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.7]"
    >
      <ExternalLinkIcon />
    </a>
  );
}

function ServiceTileCard({
  config,
  footprint,
}: CardComponentProps<ServiceTileConfig>) {
  const { status, latencyMs } = useServiceStatus(config.url, config.ping);

  if (footprint === "small") {
    return (
      <div className="flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-2">
          <Monogram name={config.name} footprint={footprint} />
          <OpenButton url={config.url} name={config.name} />
        </div>
        <div>
          <h2 className="m-0 truncate text-[14px] font-semibold tracking-[-0.01em]">
            {config.name}
          </h2>
          <StatusLine status={status} latencyMs={latencyMs} className="mt-1.5" />
        </div>
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Monogram name={config.name} footprint={footprint} />
            <div className="min-w-0">
              <h2 className="m-0 truncate text-[15px] font-semibold tracking-[-0.01em]">
                {config.name}
              </h2>
              <p className="m-0 truncate font-mono text-[11px] tracking-[0.02em] text-muted">
                {hostOf(config.url)}
              </p>
            </div>
          </div>
          <OpenButton url={config.url} name={config.name} />
        </div>
        <StatusLine status={status} latencyMs={latencyMs} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <Monogram name={config.name} footprint={footprint} />
        <OpenButton url={config.url} name={config.name} />
      </div>
      <div className="mt-auto">
        <h2 className="m-0 text-[22px] leading-[1.15] font-semibold tracking-[-0.02em]">
          {config.name}
        </h2>
        <p className="m-0 mt-1 truncate font-mono text-[12px] tracking-[0.02em] text-muted">
          {hostOf(config.url)}
        </p>
        <StatusLine status={status} latencyMs={latencyMs} className="mt-4" />
      </div>
    </div>
  );
}

function ServiceTileSettings({
  draft,
  onChange,
}: CardSettingsProps<ServiceTileConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Service name">
        {(id) => (
          <TextInput
            id={id}
            value={draft.name}
            maxLength={40}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="URL"
        hint="LAN or tailnet address, e.g. http://192.168.1.20:8123 — public hosts can't be monitored."
      >
        {(id) => (
          <TextInput
            id={id}
            value={draft.url}
            maxLength={200}
            placeholder="http://…"
            onChange={(event) => onChange({ ...draft, url: event.target.value })}
          />
        )}
      </Field>
      <Toggle
        label="Monitor with health checks"
        checked={draft.ping}
        onChange={(ping) => onChange({ ...draft, ping })}
      />
    </div>
  );
}

export const serviceTileCard: CardDefinition<ServiceTileConfig> = {
  type: "service-tile",
  name: "Service tile",
  description: "Link and live status for any service on the rack.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "small",
  defaultConfig: { name: "New service", url: "", ping: false },
  configSchema,
  Component: ServiceTileCard,
  Settings: ServiceTileSettings,
};
