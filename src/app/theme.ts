import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "rackio-theme";

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode etc.) — theme still applies for the session.
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, () => {
    return document.documentElement.dataset.theme === "light"
      ? "light"
      : "dark";
  });

  const toggleTheme = useCallback(() => {
    applyTheme(theme === "dark" ? "light" : "dark");
    listeners.forEach((notify) => notify());
  }, [theme]);

  return { theme, toggleTheme };
}
