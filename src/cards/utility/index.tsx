import { z } from "zod";
import { Field, TextInput } from "@/board/settings-fields";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";

const configSchema = z.object({
  title: z.string().max(40),
  state: z.string().max(60),
  caption: z.string().max(120),
});

type UtilityConfig = z.infer<typeof configSchema>;

function UtilityCard({ config, footprint }: CardComponentProps<UtilityConfig>) {
  const compact = footprint === "small";
  return (
    <div className={`flex h-full flex-col ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center justify-between gap-3">
        <h2
          className={`m-0 font-semibold tracking-[-0.01em] ${compact ? "text-[13px]" : "text-[15px]"}`}
        >
          {config.title}
        </h2>
        <span
          aria-label="Ready"
          className="h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-success)_14%,transparent)]"
        />
      </div>
      <div className="mt-auto pt-4">
        <p
          className={`m-0 leading-[1.2] tracking-[-0.02em] ${compact ? "text-[16px]" : "text-[22px]"}`}
        >
          {config.state}
        </p>
        {!compact && (
          <p className="m-0 mt-[7px] max-w-[30ch] text-xs tracking-[0.01em] text-muted">
            {config.caption}
          </p>
        )}
      </div>
    </div>
  );
}

function UtilitySettings({ draft, onChange }: CardSettingsProps<UtilityConfig>) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Title">
        {(id) => (
          <TextInput
            id={id}
            value={draft.title}
            maxLength={40}
            onChange={(event) =>
              onChange({ ...draft, title: event.target.value })
            }
          />
        )}
      </Field>
      <Field label="Status line">
        {(id) => (
          <TextInput
            id={id}
            value={draft.state}
            maxLength={60}
            onChange={(event) =>
              onChange({ ...draft, state: event.target.value })
            }
          />
        )}
      </Field>
      <Field label="Caption" hint="Shown on big and wide footprints.">
        {(id) => (
          <TextInput
            id={id}
            value={draft.caption}
            maxLength={120}
            onChange={(event) =>
              onChange({ ...draft, caption: event.target.value })
            }
          />
        )}
      </Field>
    </div>
  );
}

export const utilityCard: CardDefinition<UtilityConfig> = {
  type: "utility",
  name: "Utility placeholder",
  description: "A labelled placeholder tile — real service cards land in M2.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "wide",
  defaultConfig: {
    title: "New service",
    state: "Ready to connect",
    caption: "Configure this card, or replace it with a real integration.",
  },
  configSchema,
  Component: UtilityCard,
  Settings: UtilitySettings,
};
