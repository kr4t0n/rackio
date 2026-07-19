import { LiveAnnouncer } from "./app/announcer";
import { Topbar } from "./app/Topbar";
import { Board } from "./board/Board";

export function App() {
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr]">
      <Topbar />
      <Board />
      <LiveAnnouncer />
    </div>
  );
}
