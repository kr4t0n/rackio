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

/** Private ICS URLs are capability tokens — secret like a password. */
export interface CalendarConnection {
  url: string;
}

export interface AdguardConnection {
  baseUrl: string;
  user: string;
  password: string;
}

/** Plex authenticates with a token rather than a username/password. */
export interface PlexConnection {
  baseUrl: string;
  token: string;
  /** Optional display name overriding the server's own friendlyName. */
  label?: string;
}

/**
 * Docker Hub is the one integration whose credentials are optional: a
 * namespace alone reads public repositories anonymously.
 */
export interface DockerHubConnection {
  namespace: string;
  username?: string;
  /** Personal access token — never a password if it can be helped. */
  token?: string;
  label?: string;
}

/** Per-card: each downloader card points at its own torrent client. */
export interface DownloaderConnection {
  kind: "qbittorrent" | "transmission";
  baseUrl: string;
  user: string;
  password: string;
  /** Optional display name overriding the client's own. */
  label?: string;
}

interface ConnectionsFile {
  calibre?: CalibreConnection;
  calendar?: CalendarConnection;
  adguard?: AdguardConnection;
  plex?: PlexConnection;
  dockerhub?: DockerHubConnection;
  /** Keyed by card instance id. */
  downloaders?: Record<string, DownloaderConnection>;
}

export interface ConnectionStore {
  loadCalibre(): Promise<CalibreConnection | null>;
  saveCalibre(connection: CalibreConnection): Promise<void>;
  clearCalibre(): Promise<void>;
  loadCalendar(): Promise<CalendarConnection | null>;
  saveCalendar(connection: CalendarConnection): Promise<void>;
  clearCalendar(): Promise<void>;
  loadAdguard(): Promise<AdguardConnection | null>;
  saveAdguard(connection: AdguardConnection): Promise<void>;
  clearAdguard(): Promise<void>;
  loadPlex(): Promise<PlexConnection | null>;
  savePlex(connection: PlexConnection): Promise<void>;
  clearPlex(): Promise<void>;
  loadDockerHub(): Promise<DockerHubConnection | null>;
  saveDockerHub(connection: DockerHubConnection): Promise<void>;
  clearDockerHub(): Promise<void>;
  loadDownloader(instanceId: string): Promise<DownloaderConnection | null>;
  saveDownloader(
    instanceId: string,
    connection: DownloaderConnection,
  ): Promise<void>;
  clearDownloader(instanceId: string): Promise<void>;
  /** Drop connections whose card is no longer on the board. */
  pruneDownloaders(keepIds: string[]): Promise<string[]>;
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
    async loadCalendar() {
      const { calendar } = await read();
      return calendar && typeof calendar.url === "string" ? calendar : null;
    },
    saveCalendar(connection: CalendarConnection) {
      return write((file) => {
        file.calendar = connection;
      });
    },
    clearCalendar() {
      return write((file) => {
        delete file.calendar;
      });
    },
    async loadAdguard() {
      const { adguard } = await read();
      return adguard &&
        typeof adguard.baseUrl === "string" &&
        typeof adguard.user === "string" &&
        typeof adguard.password === "string"
        ? adguard
        : null;
    },
    saveAdguard(connection: AdguardConnection) {
      return write((file) => {
        file.adguard = connection;
      });
    },
    clearAdguard() {
      return write((file) => {
        delete file.adguard;
      });
    },
    async loadPlex() {
      const { plex } = await read();
      return plex &&
        typeof plex.baseUrl === "string" &&
        typeof plex.token === "string"
        ? plex
        : null;
    },
    savePlex(connection: PlexConnection) {
      return write((file) => {
        file.plex = connection;
      });
    },
    clearPlex() {
      return write((file) => {
        delete file.plex;
      });
    },
    async loadDockerHub() {
      const { dockerhub } = await read();
      return dockerhub && typeof dockerhub.namespace === "string"
        ? dockerhub
        : null;
    },
    saveDockerHub(connection: DockerHubConnection) {
      return write((file) => {
        file.dockerhub = connection;
      });
    },
    clearDockerHub() {
      return write((file) => {
        delete file.dockerhub;
      });
    },
    async loadDownloader(instanceId: string) {
      const connection = (await read()).downloaders?.[instanceId];
      return connection &&
        typeof connection.baseUrl === "string" &&
        (connection.kind === "qbittorrent" || connection.kind === "transmission")
        ? connection
        : null;
    },
    saveDownloader(instanceId: string, connection: DownloaderConnection) {
      return write((file) => {
        file.downloaders = { ...file.downloaders, [instanceId]: connection };
      });
    },
    clearDownloader(instanceId: string) {
      return write((file) => {
        if (file.downloaders) delete file.downloaders[instanceId];
      });
    },
    async pruneDownloaders(keepIds: string[]) {
      const file = await read();
      const existing = Object.keys(file.downloaders ?? {});
      const stale = existing.filter((id) => !keepIds.includes(id));
      if (stale.length === 0) return [];
      await write((draft) => {
        for (const id of stale) delete draft.downloaders?.[id];
      });
      return stale;
    },
  };
}
