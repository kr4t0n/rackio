import type { ComponentType } from "react";
import type { ZodType } from "zod";
import type { Footprint } from "@shared/types";

export interface CardComponentProps<C> {
  config: C;
  footprint: Footprint;
  instanceId: string;
}

export interface CardSettingsProps<C> {
  draft: C;
  onChange: (draft: C) => void;
}

/**
 * The card contract — the board knows nothing about a card beyond this.
 * Adding a new integration = one folder under src/cards/ exporting a
 * definition, plus a line in the registry below.
 */
export interface CardDefinition<C = unknown> {
  type: string;
  name: string;
  description: string;
  footprints: Footprint[];
  defaultFootprint: Footprint;
  defaultConfig: C;
  configSchema: ZodType<C>;
  /** Cap on simultaneous instances (e.g. WebGL scenes); unlimited if absent. */
  maxInstances?: number;
  Component: ComponentType<CardComponentProps<C>>;
  Settings: ComponentType<CardSettingsProps<C>>;
}

/* Card type modules register here. Order defines catalog order. */
import { adguardCard } from "./adguard";
import { calendarCard } from "./calendar";
import { calibreCard } from "./calibre";
import { clockCard } from "./clock";
import { serviceTileCard } from "./service-tile";
import { utilityCard } from "./utility";
import { weatherCard } from "./weather";

// Config types are erased for the heterogeneous registry; each definition's
// schema is the runtime source of truth for its own config shape.
const definitions = [
  weatherCard,
  adguardCard,
  calendarCard,
  calibreCard,
  serviceTileCard,
  clockCard,
  utilityCard,
] as unknown as ReadonlyArray<CardDefinition<never>>;

export function listCardDefinitions(): ReadonlyArray<CardDefinition<never>> {
  return definitions;
}

export function getCardDefinition(
  type: string,
): CardDefinition<never> | undefined {
  return definitions.find((definition) => definition.type === type);
}

/** Parse a stored config against the card's schema, falling back to defaults. */
export function resolveConfig<C>(
  definition: CardDefinition<C>,
  raw: unknown,
): C {
  const parsed = definition.configSchema.safeParse(raw);
  return parsed.success ? parsed.data : definition.defaultConfig;
}
