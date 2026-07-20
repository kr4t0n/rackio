import { useEffect, useReducer, useRef, useState } from "react";
import type { BoardState } from "@shared/types";
import { fetchBoard, saveBoard } from "@/lib/api";
import type { BoardAction } from "./state";
import {
  BOARD_STORAGE_KEY,
  boardReducer,
  defaultBoard,
  parseBoardState,
} from "./state";

function loadCachedBoard(): BoardState {
  try {
    return (
      parseBoardState(localStorage.getItem(BOARD_STORAGE_KEY)) ?? defaultBoard()
    );
  } catch {
    return defaultBoard();
  }
}

export interface UseBoardStateResult {
  board: BoardState;
  dispatch: React.Dispatch<BoardAction>;
  /** False until server hydration settles — gate editing UI on this. */
  ready: boolean;
}

/**
 * Board state, server-persisted. The server (`/api/board`) is the source of
 * truth so the layout follows Kyle across devices; localStorage is a warm
 * cache and offline fallback. Saves are debounced; the UI never blocks on
 * the network.
 */
export function useBoardState(): UseBoardStateResult {
  const [board, dispatch] = useReducer(boardReducer, undefined, loadCachedBoard);
  const [ready, setReady] = useState(false);
  const boardRef = useRef(board);
  const dirtyRef = useRef(false);

  // Keep the ref in sync first, before the other effects in this commit run.
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  // Hydrate from the server once. The grid renders only after this settles,
  // so a slow response can't race user edits. Newer side wins: if the local
  // cache carries a fresher updatedAt (e.g. the previous page's final save
  // lost a race with this load), keep it — the persist effect below will
  // push it back to the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remote = await fetchBoard();
        if (
          !cancelled &&
          remote &&
          (remote.updatedAt ?? 0) >= (boardRef.current.updatedAt ?? 0)
        ) {
          dispatch({ kind: "replace", board: remote });
        }
      } catch {
        // Server unreachable — the cached/default board stands.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist: localStorage immediately, server debounced.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
    } catch {
      // Storage unavailable — server persistence still applies.
    }
    dirtyRef.current = true;
    const timer = setTimeout(() => {
      saveBoard(board)
        .then(() => {
          if (boardRef.current === board) dirtyRef.current = false;
        })
        .catch((error) => {
          console.warn("rackio: board not saved to server —", error);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [board, ready]);

  // Flush pending changes when the page goes away, so a quick edit + reload
  // (or tab close) can't lose the last debounce window to a stale server.
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      fetch("/api/board", {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(boardRef.current),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  return { board, dispatch, ready };
}
