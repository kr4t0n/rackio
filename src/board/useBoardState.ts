import { useEffect, useReducer } from "react";
import type { BoardState } from "@shared/types";
import type { BoardAction } from "./state";
import {
  BOARD_STORAGE_KEY,
  boardReducer,
  defaultBoard,
  parseBoardState,
} from "./state";

function loadInitialBoard(): BoardState {
  try {
    return parseBoardState(localStorage.getItem(BOARD_STORAGE_KEY)) ?? defaultBoard();
  } catch {
    return defaultBoard();
  }
}

/**
 * Board state with localStorage persistence. Server-side persistence replaces
 * the storage layer in M2 — the BoardState shape stays the same.
 */
export function useBoardState(): [BoardState, React.Dispatch<BoardAction>] {
  const [state, dispatch] = useReducer(boardReducer, undefined, loadInitialBoard);

  useEffect(() => {
    try {
      localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable — the board still works for the session.
    }
  }, [state]);

  return [state, dispatch];
}
