import { useEffect, useState } from "react";
import { z } from "zod";
import { Toggle } from "@/board/settings-fields";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

/** Time card — local clock with day progress plus up to four world clocks.
 *  Registered as type "clock" for board compatibility with the M1 card. */

const ZONE_CHOICES = [
  ["UTC", "UTC"],
  ["America/New_York", "New York"],
  ["America/Los_Angeles", "Los Angeles"],
  ["Europe/London", "London"],
  ["Europe/Paris", "Paris"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Tokyo", "Tokyo"],
  ["Australia/Sydney", "Sydney"],
] as const;

const zoneIds = ZONE_CHOICES.map(([zone]) => zone);

const configSchema = z.object({
  hour12: z.boolean(),
  zones: z
    .array(z.enum(zoneIds as [string, ...string[]]))
    .max(4),
});

type TimeConfig = z.infer<typeof configSchema>;

const LOCAL_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

function zoneName(zone: string): string {
  return (
    ZONE_CHOICES.find(([id]) => id === zone)?.[1] ??
    zone.split("/").pop()?.replaceAll("_", " ") ??
    zone
  );
}

function timeFor(zone: string, now: Date, hour12: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12,
  }).format(now);
}

function offsetFor(zone: string, now: Date): string {
  const part = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(now)
    .find((item) => item.type === "timeZoneName");
  return part?.value ?? zone;
}

function dateFor(zone: string, now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);
}

function localParts(now: Date, hour12: boolean) {
  const withSeconds = new Intl.DateTimeFormat(undefined, {
    timeZone: LOCAL_ZONE,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  }).format(now);
  const match = withSeconds.match(/^(.*?):(\d{2})(\s?[AP]M)?$/i);
  return {
    time: match ? `${match[1]}${match[3] ?? ""}` : withSeconds,
    seconds: match ? match[2] : "00",
  };
}

function LocalClock({
  now,
  hour12,
  size,
}: {
  now: Date;
  hour12: boolean;
  size: "small" | "wide" | "big";
}) {
  const { time, seconds } = localParts(now, hour12);
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone: LOCAL_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const progress = Math.min(100, Math.max(0, minutes / 14.4));

  const timeClass =
    size === "big"
      ? "text-[clamp(52px,15cqw,76px)]"
      : size === "wide"
        ? "text-[clamp(34px,9cqw,44px)]"
        : "text-[clamp(38px,20cqw,52px)]";

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-[color-mix(in_oklch,var(--bg)_28%,var(--surface)_72%)] ${
        size === "big" ? "p-3.5" : "p-3"
      }`}
      aria-label="Local clock"
    >
      <p className="m-0 font-mono text-[9px] font-[550] tracking-[0.08em] uppercase text-muted">
        Local
      </p>
      {/* mt-auto here + mb-auto on the progress block center the time cluster
          in the space below the label (Kyle: "land in the middle"). */}
      <div className="mt-auto flex min-w-0 items-baseline gap-1.5 pt-1">
        <time
          className={`font-display font-semibold leading-[0.95] tracking-[-0.045em] whitespace-nowrap tabular-nums ${timeClass}`}
        >
          {time}
        </time>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {seconds}
        </span>
      </div>
      <p
        className={`m-0 text-muted ${size === "big" ? "mt-2 text-[11px]" : "mt-1.5 text-[10px]"}`}
      >
        {date}
      </p>
      <div
        className={`mb-auto ${size === "big" ? "mt-3" : "mt-2.5"}`}
        aria-label="Progress through the local day"
      >
        <div className="h-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--fg)_11%,transparent)]">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${progress}%` }}
          />
        </div>
        {size === "big" && (
          <div className="mt-1.5 flex justify-between font-mono text-[8px] tracking-[0.04em] text-muted">
            <span>00</span>
            <span>12</span>
            <span>24</span>
          </div>
        )}
      </div>
    </section>
  );
}

function ZoneCard({
  zone,
  now,
  hour12,
  compact,
}: {
  zone: string;
  now: Date;
  hour12: boolean;
  compact: boolean;
}) {
  return (
    <div
      className={`min-h-0 min-w-0 overflow-hidden rounded-[10px] border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_3%)] ${
        compact ? "grid content-center px-2 py-1" : "px-3 py-2.5"
      }`}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span className="truncate text-[11px] font-[550]">{zoneName(zone)}</span>
        <time
          className={`shrink-0 font-mono font-semibold tracking-[-0.02em] tabular-nums ${
            compact ? "text-[13px]" : "text-[15px]"
          }`}
        >
          {timeFor(zone, now, hour12)}
        </time>
      </div>
      <div
        className={`flex items-center justify-between gap-2 font-mono text-muted ${
          compact ? "mt-[3px] text-[8px]" : "mt-1.5 text-[9px]"
        }`}
      >
        <span>{offsetFor(zone, now)}</span>
        <span className="truncate">{dateFor(zone, now)}</span>
      </div>
    </div>
  );
}

function WorldPanel({
  zones,
  now,
  hour12,
  layout,
}: {
  zones: string[];
  now: Date;
  hour12: boolean;
  layout: "rows" | "grid";
}) {
  const shown = layout === "rows" ? zones.slice(0, 3) : zones.slice(0, 4);
  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
      aria-label="World clocks"
    >
      <div className="mb-1.5 flex min-h-[18px] items-center justify-between gap-2.5">
        <h2 className="m-0 text-[12px] font-semibold">World clocks</h2>
        <span className="font-mono text-[9px] tracking-[0.05em] text-muted uppercase">
          {zones.length} zones
        </span>
      </div>
      <div
        className={`grid min-h-0 gap-1.5 ${
          layout === "rows"
            ? "grid-rows-[repeat(3,minmax(0,1fr))]"
            : "grid-cols-2 grid-rows-2"
        }`}
      >
        {shown.map((zone) => (
          <ZoneCard
            key={zone}
            zone={zone}
            now={now}
            hour12={hour12}
            compact={layout === "rows"}
          />
        ))}
      </div>
    </section>
  );
}

function TimeCard({ config, footprint }: CardComponentProps<TimeConfig>) {
  const now = useNow();
  const hasZones = config.zones.length > 0;

  const header = (
    <header className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0">
        {footprint === "big" && (
          <p className="m-0 mb-0.5 max-w-[20ch] truncate font-mono text-[9px] font-[550] tracking-[0.08em] uppercase text-muted">
            {LOCAL_ZONE.replaceAll("_", " ")}
          </p>
        )}
        <h1
          className={`m-0 font-display font-semibold tracking-[-0.015em] ${
            footprint === "big" ? "text-[21px] leading-[1.08]" : "text-[16px]"
          }`}
        >
          Time
        </h1>
      </div>
    </header>
  );

  if (footprint === "small") {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header}
        <div className="flex min-h-0 flex-1 flex-col [&>section]:flex-1">
          <LocalClock now={now} hour12={config.hour12} size="small" />
        </div>
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {header}
        <div
          className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 ${
            hasZones ? "grid-cols-[minmax(150px,0.9fr)_minmax(0,1fr)]" : ""
          }`}
        >
          <LocalClock now={now} hour12={config.hour12} size="wide" />
          {hasZones && (
            <div className="min-h-0 overflow-hidden border-l border-border pl-3">
              <WorldPanel
                zones={config.zones}
                now={now}
                hour12={config.hour12}
                layout="rows"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3.5">
      {header}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <LocalClock now={now} hour12={config.hour12} size="big" />
        {hasZones ? (
          <WorldPanel
            zones={config.zones}
            now={now}
            hour12={config.hour12}
            layout="grid"
          />
        ) : (
          <p className="m-0 self-end text-xs text-muted">
            Add world clocks from this card's settings.
          </p>
        )}
      </div>
    </div>
  );
}

function TimeSettings({ draft, onChange }: CardSettingsProps<TimeConfig>) {
  const atLimit = draft.zones.length >= 4;
  return (
    <div className="flex flex-col gap-4">
      <Toggle
        label="12-hour time"
        checked={draft.hour12}
        onChange={(hour12) => onChange({ ...draft, hour12 })}
      />
      <div>
        <p className="m-0 mb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted">
          World clocks · up to four
        </p>
        <div className="flex flex-col gap-1.5">
          {ZONE_CHOICES.map(([zone, label]) => {
            const checked = draft.zones.includes(zone);
            const disabled = !checked && atLimit;
            return (
              <label
                key={zone}
                className={`flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-bg px-3 text-sm ${
                  disabled ? "opacity-45" : "cursor-pointer hover:border-[color-mix(in_oklch,var(--fg)_20%,transparent)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      zones: event.target.checked
                        ? [...draft.zones, zone]
                        : draft.zones.filter((z) => z !== zone),
                    })
                  }
                  className="h-[18px] w-[18px] accent-(--accent)"
                />
                <span className="min-w-0 truncate">
                  {label} <span className="text-muted">· {zone}</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const clockCard: CardDefinition<TimeConfig> = {
  type: "clock",
  name: "Time",
  description: "Local time with day progress and world clocks.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "wide",
  defaultConfig: {
    hour12: false,
    zones: ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"],
  },
  configSchema,
  Component: TimeCard,
  Settings: TimeSettings,
};
