import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAnnouncer } from "./app/announcer";
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
      <div className="grid min-h-dvh grid-rows-[auto_1fr]">
        <Topbar />
        <Board />
        <LiveAnnouncer />
      </div>
    </QueryClientProvider>
  );
}
