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

export interface CalibreBook {
  id: number;
  title: string;
  author: string;
  summary?: string;
  published?: string;
}

export interface CalibreShelf {
  configured: boolean;
  webUrl?: string;
  books?: CalibreBook[];
  error?: "unauthorized" | "unreachable" | "not-opds";
}

export function fetchCalibreShelf(source: "new" | "hot"): Promise<CalibreShelf> {
  return request<CalibreShelf>(`/api/calibre/books?source=${source}`);
}

export function calibreCoverUrl(id: number): string {
  return `/api/calibre/cover/${id}`;
}

export interface CalibreConnectionStatus {
  configured: boolean;
  source?: "env" | "saved";
  baseUrl?: string;
  user?: string;
}

export function fetchCalibreConnection(): Promise<CalibreConnectionStatus> {
  return request<CalibreConnectionStatus>("/api/calibre/connection");
}

export interface ConnectResult {
  ok: boolean;
  books?: number;
  error?: "unauthorized" | "unreachable" | "not-opds";
}

export function saveCalibreConnection(connection: {
  baseUrl: string;
  user: string;
  password: string;
}): Promise<ConnectResult> {
  return request<ConnectResult>("/api/calibre/connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
}

export function clearCalibreConnection(): Promise<void> {
  return request("/api/calibre/connection", { method: "DELETE" });
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
}

export interface CalendarFeed {
  configured: boolean;
  events?: CalendarEvent[];
  error?: "unreachable" | "not-ics";
}

export function fetchCalendarEvents(): Promise<CalendarFeed> {
  return request<CalendarFeed>("/api/calendar/events");
}

export interface CalendarConnectionStatus {
  configured: boolean;
  source?: "env" | "saved";
  host?: string;
}

export function fetchCalendarConnection(): Promise<CalendarConnectionStatus> {
  return request<CalendarConnectionStatus>("/api/calendar/connection");
}

export interface CalendarConnectResult {
  ok: boolean;
  events?: number;
  error?: "unreachable" | "not-ics";
}

export function saveCalendarConnection(url: string): Promise<CalendarConnectResult> {
  return request<CalendarConnectResult>("/api/calendar/connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function clearCalendarConnection(): Promise<void> {
  return request("/api/calendar/connection", { method: "DELETE" });
}
