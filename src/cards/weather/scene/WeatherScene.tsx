import { useEffect, useRef, useState } from "react";
import type { SceneMode } from "@/lib/api";
import { WeatherSceneEngine } from "./engine";

/** Static gradients per mode — the base layer behind the canvas and the whole
 *  scene when WebGL is unavailable. Ported from the reference design. */
const FALLBACK_GRADIENT: Record<SceneMode, string> = {
  clear:
    "linear-gradient(160deg, oklch(68% 0.13 225), oklch(47% 0.15 245) 55%, oklch(31% 0.07 256))",
  cloudy:
    "linear-gradient(160deg, oklch(53% 0.13 238), oklch(31% 0.08 252) 54%, oklch(24% 0.03 250))",
  rain: "linear-gradient(160deg, oklch(53% 0.13 238), oklch(31% 0.08 252) 54%, oklch(24% 0.03 250))",
  storm:
    "linear-gradient(160deg, oklch(39% 0.04 232), oklch(23% 0.04 255) 60%, oklch(17% 0.025 265))",
  snow: "linear-gradient(160deg, oklch(70% 0.04 225), oklch(47% 0.065 238) 56%, oklch(30% 0.05 252))",
};

function detectWebGL(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

/** Night counterparts, so the fallback (and the frame before the first
 *  render) doesn't flash a daylit sky at midnight. */
const FALLBACK_GRADIENT_NIGHT: Record<SceneMode, string> = {
  clear:
    "linear-gradient(160deg, oklch(28% 0.06 258), oklch(19% 0.05 262) 55%, oklch(13% 0.03 265))",
  cloudy:
    "linear-gradient(160deg, oklch(25% 0.045 258), oklch(17% 0.035 262) 54%, oklch(12% 0.02 265))",
  rain: "linear-gradient(160deg, oklch(25% 0.045 258), oklch(17% 0.035 262) 54%, oklch(12% 0.02 265))",
  storm:
    "linear-gradient(160deg, oklch(19% 0.03 260), oklch(13% 0.025 265) 60%, oklch(9% 0.015 268))",
  snow: "linear-gradient(160deg, oklch(33% 0.03 255), oklch(22% 0.03 260) 56%, oklch(15% 0.02 264))",
};

export function WeatherScene({
  mode,
  isDay = true,
}: {
  mode: SceneMode;
  isDay?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WeatherSceneEngine | null>(null);
  const [webglAvailable] = useState(detectWebGL);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let engine: WeatherSceneEngine;
    try {
      engine = new WeatherSceneEngine(canvas, !reducedMotion);
    } catch (error) {
      // Empty canvas is transparent — the gradient behind it shows through.
      console.warn("rackio: WebGL weather unavailable, using gradient.", error);
      return;
    }
    engineRef.current = engine;
    // The mode/isDay sync effect below runs right after mount, so the
    // initial state lands there rather than being applied twice here.

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      engine.resize(Math.floor(width), Math.floor(height));
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setMode(mode, isDay);
  }, [mode, isDay]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 isolate"
      style={{
        background: isDay
          ? FALLBACK_GRADIENT[mode]
          : FALLBACK_GRADIENT_NIGHT[mode],
      }}
    >
      {webglAvailable && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full opacity-[0.98] saturate-[1.04] contrast-[1.03]"
        />
      )}
      {/* Legibility scrim over the scene, under the content. */}
      <div className="pointer-events-none absolute inset-0 z-1 bg-[linear-gradient(to_top,oklch(8%_0.02_250_/_0.62),transparent_60%)]" />
    </div>
  );
}
