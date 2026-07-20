import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Server-side storage for integration credentials (e.g. Calibre-Web).
 * Secrets must never enter board.json — the board syncs to every client.
 * This file lives in DATA_DIR with 0600 permissions instead.
 */

export interface CalibreConnection {
  baseUrl: string;
  user: string;
  password: string;
}

interface ConnectionsFile {
  calibre?: CalibreConnection;
}

export interface ConnectionStore {
  loadCalibre(): Promise<CalibreConnection | null>;
  saveCalibre(connection: CalibreConnection): Promise<void>;
  clearCalibre(): Promise<void>;
}

export function createConnectionStore(dataDir: string): ConnectionStore {
  const filePath = join(dataDir, "connections.json");
  const tempPath = join(dataDir, "connections.json.tmp");
  let writeQueue: Promise<void> = Promise.resolve();

  async function read(): Promise<ConnectionsFile> {
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as ConnectionsFile;
    } catch {
      return {};
    }
  }

  function write(mutate: (file: ConnectionsFile) => void): Promise<void> {
    const task = writeQueue.then(async () => {
      const file = await read();
      mutate(file);
      await mkdir(dataDir, { recursive: true });
      await writeFile(tempPath, JSON.stringify(file, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(tempPath, 0o600);
      await rename(tempPath, filePath);
    });
    writeQueue = task.catch(() => {});
    return task;
  }

  return {
    async loadCalibre() {
      const { calibre } = await read();
      return calibre &&
        typeof calibre.baseUrl === "string" &&
        typeof calibre.user === "string" &&
        typeof calibre.password === "string"
        ? calibre
        : null;
    },
    saveCalibre(connection: CalibreConnection) {
      return write((file) => {
        file.calibre = connection;
      });
    },
    clearCalibre() {
      return write((file) => {
        delete file.calibre;
      });
    },
  };
}
