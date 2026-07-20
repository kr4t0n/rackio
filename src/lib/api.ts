import type { BoardState } from "@shared/types";
import { validateBoardState } from "@shared/board-schema";

/** Typed client for the rackio API. All service traffic goes through /api —
 *  the SPA never talks to rack services directly. */

export interface PingResult {
  up: boolean;
  status?: number;
  latencyMs?: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchBoard(): Promise<BoardState | null> {
  const { board } = await request<{ board: unknown }>("/api/board");
  return board === null ? null : validateBoardState(board);
}

export async function saveBoard(board: BoardState): Promise<void> {
  await request("/api/board", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(board),
  });
}

export function pingService(url: string): Promise<PingResult> {
  return request<PingResult>(`/api/ping?url=${encodeURIComponent(url)}`);
}

export type SceneMode = "clear" | "cloudy" | "rain" | "storm" | "snow";

export interface WeatherReport {
  sceneMode: SceneMode;
  condition: string;
  temperature: number;
  feelsLike: number;
  high: number;
  low: number;
  windKmh: number;
  humidity: number;
  precipChance: number;
  visibilityKm: number;
  isDay: boolean;
  updatedAt: number;
}

export function fetchWeather(lat: number, lon: number): Promise<WeatherReport> {
  return request<WeatherReport>(`/api/weather?lat=${lat}&lon=${lon}`);
}

export interface GeocodeMatch {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
}

export async function geocodeSearch(query: string): Promise<GeocodeMatch[]> {
  const { matches } = await request<{ matches: GeocodeMatch[] }>(
    `/api/geocode?q=${encodeURIComponent(query)}`,
  );
  return matches;
}
