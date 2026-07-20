import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BoardState } from "../shared/types.ts";
import { validateBoardState } from "../shared/board-schema.ts";

/**
 * Board persistence: one JSON file on disk. Single-user homelab — no DB.
 * Writes are atomic (temp file + rename) and serialized through a queue so
 * concurrent PUTs can't interleave.
 */
export interface BoardStore {
  load(): Promise<BoardState | null>;
  save(state: BoardState): Promise<void>;
}

export function createBoardStore(dataDir: string): BoardStore {
  const filePath = join(dataDir, "board.json");
  const tempPath = join(dataDir, "board.json.tmp");
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async load() {
      try {
        const raw = await readFile(filePath, "utf8");
        return validateBoardState(JSON.parse(raw));
      } catch {
        return null; // missing file or unreadable JSON — client falls back
      }
    },

    save(state: BoardState) {
      const write = writeQueue.then(async () => {
        await mkdir(dataDir, { recursive: true });
        await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
        await rename(tempPath, filePath);
      });
      // Keep the queue alive even if a write fails.
      writeQueue = write.catch(() => {});
      return write;
    },
  };
}
