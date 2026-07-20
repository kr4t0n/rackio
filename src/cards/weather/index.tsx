import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Field, TextInput } from "@/board/settings-fields";
import { geocodeSearch } from "@/lib/api";
import type {
  CardComponentProps,
  CardDefinition,
  CardSettingsProps,
} from "../registry";
import type { WeatherConfig } from "./WeatherCard";
import { WeatherCard } from "./WeatherCard";

const configSchema = z.object({
  locationName: z.string().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function Card({ config, footprint }: CardComponentProps<WeatherConfig>) {
  return <WeatherCard config={config} footprint={footprint} />;
}

function WeatherSettings({ draft, onChange }: CardSettingsProps<WeatherConfig>) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim(), 350);
  const results = useQuery({
    queryKey: ["geocode", debounced],
    queryFn: () => geocodeSearch(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border bg-bg px-3.5 py-3">
        <span className="min-w-0 truncate text-sm font-[550]">
          {draft.locationName}
        </span>
        <span className="shrink-0 font-mono text-[11px] tracking-[0.02em] text-muted tabular-nums">
          {draft.lat.toFixed(2)}, {draft.lon.toFixed(2)}
        </span>
      </div>
      <Field label="Search location" hint="Powered by Open-Meteo geocoding.">
        {(id) => (
          <TextInput
            id={id}
            value={search}
            placeholder="City or place name…"
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
      </Field>
      {results.data && results.data.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0" role="listbox">
          {results.data.map((match) => (
            <li key={`${match.lat},${match.lon}`}>
              <button
                type="button"
                className="flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-xl border border-transparent px-3.5 py-2.5 text-left transition-colors hover:border-border hover:bg-[color-mix(in_oklch,var(--fg)_5%,transparent)]"
                onClick={() => {
                  onChange({
                    locationName: match.region
                      ? `${match.name}, ${match.region}`
                      : match.name,
                    lat: match.lat,
                    lon: match.lon,
                  });
                  setSearch("");
                }}
              >
                <span className="min-w-0 truncate text-sm">
                  {match.name}
                  {match.region ? (
                    <span className="text-muted"> · {match.region}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {match.country}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : debounced.length >= 2 && results.isSuccess ? (
        <p className="m-0 px-1 text-xs text-muted">No places found.</p>
      ) : null}
    </div>
  );
}

export const weatherCard: CardDefinition<WeatherConfig> = {
  type: "weather",
  name: "Weather",
  description: "Live conditions with an animated sky for a chosen place.",
  footprints: ["small", "big", "wide"],
  defaultFootprint: "wide",
  defaultConfig: { locationName: "London", lat: 51.5072, lon: -0.1276 },
  configSchema,
  maxInstances: 1,
  Component: Card,
  Settings: WeatherSettings,
};
