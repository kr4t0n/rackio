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
