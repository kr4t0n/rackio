import { useEffect, useState } from "react";
import { z } from "zod";
import { Field, TextInput, Toggle } from "@/board/settings-fields";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({
  label: z.string().max(40),
  use24h: z.boolean(),
  showSeconds: z.boolean(),
});

type ClockConfig = z.infer<typeof configSchema>;

function useNow(tickMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(interval);
  }, [tickMs]);
  return now;
}

function formatTime(now: Date, config: ClockConfig): string {
  return now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    ...(config.showSeconds ? { second: "2-digit" } : {}),
    hour12: !config.use24h,
  });
}

function formatDate(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function ClockCard({ config, footprint }: CardComponentProps<ClockConfig>) {
  const now = useNow(config.showSeconds ? 1000 : 5000);
  const time = formatTime(now, config);
  const date = formatDate(now);

  const timeClass =
    "m-0 font-display font-normal leading-[0.9] tracking-[-0.05em] tabular-nums";

  if (footprint === "small") {
    return (
      <div className="flex h-full flex-col justify-between p-4">
        <p className="m-0 max-w-[14ch] text-[11px] font-[550] tracking-[0.02em] text-muted">
          {config.label}
        </p>
        <div>
          <p className={`${timeClass} text-[clamp(30px,3.4cqw,44px)]`}>{time}</p>
          <p className="m-0 mt-2 text-[12px] text-muted">{date}</p>
        </div>
      </div>
    );
  }

  if (footprint === "wide") {
    return (
      <div className="flex h-full flex-col justify-between p-5">
        <p className="m-0 text-[13px] font-[550] tracking-[0.02em] text-muted">
          {config.label}
        </p>
        <div className="flex items-end justify-between gap-4">
          <p className={`${timeClass} text-[clamp(48px,6cqw,72px)]`}>{time}</p>
          <div className="pb-1 text-right">
            <p className="m-0 text-[14px] font-[550]">{date}</p>
            <p className="m-0 mt-0.5 font-mono text-[11px] tracking-[0.02em] text-muted">
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-between p-6">
      <p className="m-0 text-[13px] font-[550] tracking-[0.02em] text-muted">
        {config.label}
      </p>
      <div>
        <p className={`${timeClass} text-[clamp(64px,9cqw,112px)]`}>{time}</p>
        <p className="m-0 mt-3 text-[16px] font-[550]">{date}</p>
        <p className="m-0 mt-1 font-mono text-[11px] tracking-[0.02em] text-muted">
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
      </div>
    </div>
  );
}

function ClockSettings({ draft, onChange }: CardSettingsProps<ClockConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Label">
        {(id) => (
          <TextInput
            id={id}
            value={draft.label}
            maxLength={40}
            onChange={(event) =>
              onChange({ ...draft, label: event.target.value })
            }
          />
        )}
      </Field>
      <Toggle
        label="24-hour time"
        checked={draft.use24h}
        onChange={(use24h) => onChange({ ...draft, use24h })}
      />
      <Toggle
        label="Show seconds"
        checked={draft.showSeconds}
        onChange={(showSeconds) => onChange({ ...draft, showSeconds })}
      />
    </div>
  );
}

export const clockCard: CardDefinition<ClockConfig> = {
  type: "clock",
  name: "Clock",
  description: "Local time and date for the rack.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "wide",
  defaultConfig: { label: "Home rack", use24h: true, showSeconds: false },
  configSchema,
  Component: ClockCard,
  Settings: ClockSettings,
};
