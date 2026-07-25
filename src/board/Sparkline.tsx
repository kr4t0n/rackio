import { useRef, useState } from "react";

/**
 * Shared activity sparkline: smoothed area + line with a hover/keyboard
 * crosshair and tooltip. Used by the adguard and downloader cards; callers
 * supply the value/label formatting so the chart stays domain-agnostic.
 */

const VIEW_W = 100;
const VIEW_H = 42;
const TOP_PAD = 5;

interface Point {
  x: number;
  y: number;
}

function buildPath(values: number[]): { line: string; points: Point[] } {
  if (values.length < 2) return { line: "", points: [] };
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => ({
    x: (index * VIEW_W) / (values.length - 1),
    y: VIEW_H - TOP_PAD - (value / max) * (VIEW_H - TOP_PAD * 2),
  }));
  let line = `M${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const mid = (previous.x + point.x) / 2;
    line += ` C${mid.toFixed(2)} ${previous.y.toFixed(2)} ${mid.toFixed(2)} ${point.y.toFixed(2)} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }
  return { line, points };
}

export interface SparklineProps {
  values: number[];
  /** Tooltip headline for a value, e.g. "57 blocked" or "42.8 MB/s". */
  formatValue: (value: number, index: number) => string;
  /** Tooltip caption for a point, e.g. "23:00" or "30s ago". */
  formatLabel: (index: number, length: number) => string;
  ariaLabel: string;
  /** Axis ticks under the plot; hidden automatically on tight cards. */
  showAxis?: boolean;
  emptyLabel?: string;
}

export function Sparkline({
  values,
  formatValue,
  formatLabel,
  ariaLabel,
  showAxis = false,
  emptyLabel = "No activity yet",
}: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const { line, points } = buildPath(values);

  if (!line) {
    return (
      <div className="grid min-h-0 place-items-center text-[9px] text-muted">
        {emptyLabel}
      </div>
    );
  }

  const move = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * (points.length - 1)));
  };

  const point = active === null ? null : points[active];

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div
        ref={containerRef}
        role="img"
        tabIndex={0}
        aria-label={ariaLabel}
        // min-h stays small: a taller floor overflows the panel (and paints
        // over the axis) once cards shrink on a narrow board.
        className="relative min-h-[24px] overflow-hidden rounded-[5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onPointerMove={(event) => move(event.clientX)}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setActive((current) => {
            const next =
              (current ?? points.length - 1) + (event.key === "ArrowRight" ? 1 : -1);
            return Math.max(0, Math.min(points.length - 1, next));
          });
        }}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="block h-full w-full"
        >
          <path
            d={`M0 12H${VIEW_W}M0 26H${VIEW_W}`}
            className="fill-none stroke-border [stroke-dasharray:2_3] [stroke-width:0.7] [vector-effect:non-scaling-stroke]"
          />
          <path
            d={`${line} L${VIEW_W} ${VIEW_H} L0 ${VIEW_H} Z`}
            className="fill-[color-mix(in_oklch,var(--accent)_15%,transparent)]"
          />
          <path
            d={line}
            className="fill-none stroke-accent [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7] [vector-effect:non-scaling-stroke]"
          />
        </svg>

        {point && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-[color-mix(in_oklch,var(--fg)_25%,transparent)]"
              style={{ left: `${point.x}%` }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_14%,transparent)]"
              style={{ left: `${point.x}%`, top: `${(point.y / VIEW_H) * 100}%` }}
            />
            <span
              role="status"
              className="pointer-events-none absolute z-2 min-w-max -translate-x-1/2 rounded-[7px] border border-border bg-[color-mix(in_oklch,var(--surface)_92%,var(--bg)_8%)] px-[7px] py-[5px] font-mono text-[8px] leading-[1.2] font-semibold shadow-[0_8px_20px_color-mix(in_oklch,var(--bg)_55%,transparent)]"
              style={{
                left: `${Math.max(14, Math.min(86, point.x))}%`,
                top: point.y < 16 ? `${(point.y / VIEW_H) * 100 + 14}%` : undefined,
                bottom:
                  point.y < 16 ? undefined : `${100 - (point.y / VIEW_H) * 100 + 6}%`,
              }}
            >
              {formatValue(values[active!], active!)}
              <span className="ml-1.5 font-normal text-muted">
                {formatLabel(active!, values.length)}
              </span>
            </span>
          </>
        )}
      </div>
      {showAxis && (
        // Only when the card is roomy — on a narrow board the panel can't
        // spare the row and the labels crowd the plot.
        <div className="mt-1.5 hidden justify-between font-mono text-[7px] tracking-[0.04em] text-muted @[400px]:flex">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <span key={fraction}>
              {formatLabel(
                Math.round(fraction * (values.length - 1)),
                values.length,
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
