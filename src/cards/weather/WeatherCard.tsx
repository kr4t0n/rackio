import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Footprint } from "@shared/types";
import type { SceneMode, WeatherReport } from "@/lib/api";
import { fetchWeather } from "@/lib/api";

// three.js is heavy — load the scene (and three with it) only when a weather
// card is actually on the board. The fallback gradient renders meanwhile.
const WeatherScene = lazy(() =>
  import("./scene/WeatherScene").then((m) => ({ default: m.WeatherScene })),
);

const SUSPENSE_GRADIENT =
  "linear-gradient(160deg, oklch(53% 0.13 238), oklch(31% 0.08 252) 54%, oklch(24% 0.03 250))";

export interface WeatherConfig {
  locationName: string;
  lat: number;
  lon: number;
}

function Metrics({
  report,
  columns,
}: {
  report: WeatherReport;
  columns: 2 | 4;
}) {
  const metrics = [
    { label: "Precip.", value: `${report.precipChance}%` },
    { label: "Wind", value: `${report.windKmh} km/h` },
    { label: "Humidity", value: `${report.humidity}%` },
    { label: "Visibility", value: `${report.visibilityKm} km` },
  ];
  return (
    <div
      className={`grid border-t border-white/20 pt-3.5 ${
        columns === 4 ? "grid-cols-4" : "grid-cols-2 gap-y-3"
      }`}
    >
      {metrics.map((metric, index) => (
        <div
          key={metric.label}
          className={`min-w-0 pr-3.5 ${
            index % columns !== 0 ? "border-l border-white/15 pl-3.5" : ""
          }`}
        >
          <span className="mb-1 block text-[10px] font-semibold tracking-[0.09em] uppercase opacity-[0.58]">
            {metric.label}
          </span>
          <span className="block font-mono text-[13px] whitespace-nowrap tabular-nums">
            {metric.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const TEMP_CLASS =
  "m-0 font-display font-normal leading-[0.82] tracking-[-0.055em] tabular-nums";

export function WeatherCard({
  config,
  footprint,
}: {
  config: WeatherConfig;
  footprint: Footprint;
}) {
  const query = useQuery({
    queryKey: ["weather", config.lat, config.lon],
    queryFn: () => fetchWeather(config.lat, config.lon),
    refetchInterval: 10 * 60_000,
    staleTime: 9 * 60_000,
  });
  const report = query.data;
  const mode: SceneMode = report?.sceneMode ?? "cloudy";
  const temperature = report ? `${report.temperature}°` : "—";
  const condition = query.isError
    ? "Weather unavailable"
    : (report?.condition ?? "Fetching sky…");
  const updated = report
    ? new Date(report.updatedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="relative h-full overflow-hidden">
      <Suspense
        fallback={
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ background: SUSPENSE_GRADIENT }}
          />
        }
      >
        <WeatherScene mode={mode} />
      </Suspense>
      <div className="relative z-3 grid h-full grid-rows-[auto_1fr_auto] p-5 text-[oklch(98%_0.004_240)] [text-shadow:0_1px_18px_oklch(13%_0.03_250_/_0.3)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p
              className={`m-0 font-[550] tracking-[0.02em] ${
                footprint === "small"
                  ? "max-w-[14ch] text-[11px] leading-[1.25]"
                  : "text-sm"
              }`}
            >
              {config.locationName}
            </p>
            {footprint === "big" && updated ? (
              <p className="m-0 mt-0.5 font-mono text-[11px] tracking-[0.02em] opacity-[0.68] uppercase">
                Updated {updated}
              </p>
            ) : null}
          </div>
        </div>

        {footprint === "wide" ? (
          <div className="row-start-3 grid grid-cols-[minmax(96px,0.7fr)_minmax(120px,1fr)] items-end gap-4">
            <p className={`${TEMP_CLASS} text-[clamp(48px,15cqw,74px)]`}>
              {temperature}
            </p>
            <div className="pb-1">
              <p className="m-0 text-[16px] leading-[1.15] font-[550] tracking-[-0.01em]">
                {condition}
              </p>
              {report ? (
                <p className="m-0 mt-[3px] text-[11px] opacity-[0.74]">
                  Feels like {report.feelsLike}° · High {report.high}° / Low{" "}
                  {report.low}°
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="self-end pb-2">
              <p
                className={`${TEMP_CLASS} ${
                  footprint === "small"
                    ? "text-[clamp(44px,26cqw,68px)]"
                    : "text-[clamp(64px,20cqw,98px)]"
                }`}
              >
                {temperature}
              </p>
              <p
                className={`m-0 font-[550] tracking-[-0.01em] ${
                  footprint === "small"
                    ? "mt-2.5 text-[14px] leading-[1.2]"
                    : "mt-3 text-[19px] leading-[1.15]"
                }`}
              >
                {condition}
              </p>
              {footprint === "big" && report ? (
                <p className="m-0 mt-[5px] text-[13px] opacity-[0.74]">
                  Feels like {report.feelsLike}° · High {report.high}° / Low{" "}
                  {report.low}°
                </p>
              ) : null}
            </div>
            {footprint === "big" && report ? (
              <Metrics report={report} columns={2} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
