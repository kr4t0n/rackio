/**
 * Shell mode — which chrome the SPA renders around the board.
 *
 * `app` is the normal browser dashboard. `wallpaper` is a read-only,
 * transparent, chrome-less render: no topbar, no blueprint background, no
 * edit affordances. It exists for the macOS desktop app in `mac/`, which
 * loads this same SPA in a WKWebView pinned to the desktop window level, so
 * the cards sit live on the wallpaper.
 *
 * The mode comes from the URL and is fixed for the document's lifetime, so it
 * resolves once at module load rather than through context or state. The
 * pre-paint script in index.html mirrors this — keep the two in sync (same
 * arrangement as the theme, see AGENTS.md).
 */
export type Shell = "app" | "wallpaper";

export function resolveShell(search: string): Shell {
  try {
    return new URLSearchParams(search).get("shell") === "wallpaper"
      ? "wallpaper"
      : "app";
  } catch {
    return "app";
  }
}

export const shell: Shell =
  typeof window === "undefined" ? "app" : resolveShell(window.location.search);

export const isWallpaper = shell === "wallpaper";
