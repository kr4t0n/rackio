import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAnnouncer } from "./app/announcer";
import { isWallpaper } from "./app/shell";
import { Topbar } from "./app/Topbar";
import { Board } from "./board/Board";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* The wallpaper shell drops the topbar — the desktop is the chrome. */}
      <div
        className={
          isWallpaper ? "min-h-dvh" : "grid min-h-dvh grid-rows-[auto_1fr]"
        }
      >
        {!isWallpaper && <Topbar />}
        <Board />
        <LiveAnnouncer />
      </div>
    </QueryClientProvider>
  );
}
