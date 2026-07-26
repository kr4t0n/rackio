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

export interface AdguardRank {
  name: string;
  count: number;
}

export interface AdguardStats {
  configured: boolean;
  protectionEnabled?: boolean;
  queries?: number;
  blocked?: number;
  threats?: number;
  blockRate?: number;
  avgProcessingMs?: number;
  series?: number[];
  timeUnit?: "hours" | "days";
  topBlockedDomains?: AdguardRank[];
  topClients?: AdguardRank[];
  error?: "unauthorized" | "unreachable" | "not-adguard";
}

export function fetchAdguardStats(): Promise<AdguardStats> {
  return request<AdguardStats>("/api/adguard/stats");
}

export interface AdguardConnectionStatus {
  configured: boolean;
  baseUrl?: string;
  user?: string;
}

export function fetchAdguardConnection(): Promise<AdguardConnectionStatus> {
  return request<AdguardConnectionStatus>("/api/adguard/connection");
}

export interface AdguardConnectResult {
  ok: boolean;
  queries?: number;
  error?: "unauthorized" | "unreachable" | "not-adguard";
}

export function saveAdguardConnection(connection: {
  baseUrl: string;
  user: string;
  password: string;
}): Promise<AdguardConnectResult> {
  return request<AdguardConnectResult>("/api/adguard/connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
}

export function clearAdguardConnection(): Promise<void> {
  return request("/api/adguard/connection", { method: "DELETE" });
}

export type DownloaderKind = "qbittorrent" | "transmission";

export type TransferState =
  | "downloading"
  | "seeding"
  | "queued"
  | "paused"
  | "checking"
  | "done";

export interface DownloaderTransfer {
  id: string;
  name: string;
  progress: number;
  state: TransferState;
  downSpeed: number;
  upSpeed: number;
  eta?: number;
}

export interface DownloaderStats {
  configured: boolean;
  kind?: DownloaderKind;
  clientName?: string;
  downSpeed?: number;
  upSpeed?: number;
  activeCount?: number;
  totalCount?: number;
  transfers?: DownloaderTransfer[];
  history?: number[];
  historyAges?: number[];
  error?: "unauthorized" | "unreachable" | "not-client";
}

/** Downloader endpoints are per card instance — several clients coexist. */
export function fetchDownloaderStats(instanceId: string): Promise<DownloaderStats> {
  return request<DownloaderStats>(`/api/downloader/${instanceId}/stats`);
}

export interface DownloaderConnectionStatus {
  configured: boolean;
  kind?: DownloaderKind;
  baseUrl?: string;
  user?: string;
  label?: string;
}

export function fetchDownloaderConnection(
  instanceId: string,
): Promise<DownloaderConnectionStatus> {
  return request<DownloaderConnectionStatus>(
    `/api/downloader/${instanceId}/connection`,
  );
}

export interface DownloaderConnectResult {
  ok: boolean;
  transfers?: number;
  error?: "unauthorized" | "unreachable" | "not-client";
}

export function saveDownloaderConnection(
  instanceId: string,
  connection: {
    kind: DownloaderKind;
    baseUrl: string;
    user: string;
    password: string;
    label?: string;
  },
): Promise<DownloaderConnectResult> {
  return request<DownloaderConnectResult>(
    `/api/downloader/${instanceId}/connection`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connection),
    },
  );
}

export function clearDownloaderConnection(instanceId: string): Promise<void> {
  return request(`/api/downloader/${instanceId}/connection`, { method: "DELETE" });
}

export interface PlexItem {
  id: string;
  kind: "watching" | "recent";
  title: string;
  showTitle?: string;
  detail: string;
  progress: number;
  artPath?: string;
  posterPath?: string;
  webUrl?: string;
}

export interface PlexState {
  configured: boolean;
  serverName?: string;
  items?: PlexItem[];
  /** Recently added, deduped against `items`; backfills the queue. */
  recent?: PlexItem[];
  error?: "unauthorized" | "unreachable" | "not-plex";
}

export function fetchPlexState(): Promise<PlexState> {
  return request<PlexState>("/api/plex/state");
}

/** Artwork is proxied so the Plex token never reaches the browser. */
export function plexArtUrl(path: string, width: number, height: number): string {
  return `/api/plex/art?path=${encodeURIComponent(path)}&w=${width}&h=${height}`;
}

export interface PlexConnectionStatus {
  configured: boolean;
  baseUrl?: string;
  label?: string;
}

export function fetchPlexConnection(): Promise<PlexConnectionStatus> {
  return request<PlexConnectionStatus>("/api/plex/connection");
}

export interface PlexConnectResult {
  ok: boolean;
  items?: number;
  error?: "unauthorized" | "unreachable" | "not-plex";
}

export function savePlexConnection(connection: {
  baseUrl: string;
  token: string;
  label?: string;
}): Promise<PlexConnectResult> {
  return request<PlexConnectResult>("/api/plex/connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
}

export function clearPlexConnection(): Promise<void> {
  return request("/api/plex/connection", { method: "DELETE" });
}

export interface DockerImage {
  name: string;
  repo: string;
  tag: string;
  isPrivate: boolean;
  digest?: string;
  sizeBytes?: number;
  architectures: string[];
  updatedAt?: string;
  description?: string;
  pullCommand: string;
  webUrl: string;
}

export interface DockerHubState {
  configured: boolean;
  namespace?: string;
  label?: string;
  authenticated?: boolean;
  images?: DockerImage[];
  error?: "unauthorized" | "unreachable" | "not-found";
}

export function fetchDockerHubState(): Promise<DockerHubState> {
  return request<DockerHubState>("/api/dockerhub/state");
}

export interface DockerHubConnectionStatus {
  configured: boolean;
  namespace?: string;
  username?: string;
  authenticated?: boolean;
  label?: string;
}

export function fetchDockerHubConnection(): Promise<DockerHubConnectionStatus> {
  return request<DockerHubConnectionStatus>("/api/dockerhub/connection");
}

export interface DockerHubConnectResult {
  ok: boolean;
  images?: number;
  error?: "unauthorized" | "unreachable" | "not-found" | "incomplete-credentials";
}

export function saveDockerHubConnection(connection: {
  namespace: string;
  username?: string;
  token?: string;
  label?: string;
}): Promise<DockerHubConnectResult> {
  return request<DockerHubConnectResult>("/api/dockerhub/connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
}

export function clearDockerHubConnection(): Promise<void> {
  return request("/api/dockerhub/connection", { method: "DELETE" });
}
