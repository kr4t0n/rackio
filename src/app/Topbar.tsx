import { IconButton } from "./controls";
import { useTheme } from "./theme";

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="grid h-[29px] w-[29px] -rotate-2 grid-cols-2 gap-[3px] rounded-lg border border-[color-mix(in_oklch,var(--fg)_24%,transparent)] p-[5px]"
    >
      <span className="rounded-[2px] bg-fg opacity-[0.88]" />
      <span className="rounded-[2px] bg-fg opacity-[0.88]" />
      <span className="rounded-[2px] bg-fg opacity-[0.88]" />
      <span className="rounded-[2px] bg-fg opacity-[0.88]" />
    </span>
  );
}

function ThemeIcon({ theme }: { theme: "dark" | "light" }) {
  return theme === "dark" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.7 6.7 0 0 0 21 12.8Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </svg>
  );
}

export function Topbar() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 flex min-h-[68px] items-center gap-6 border-b border-border bg-[color-mix(in_oklch,var(--bg)_82%,transparent)] px-[clamp(16px,3vw,40px)] py-3 backdrop-blur-[18px] backdrop-saturate-130">
      <div className="flex min-w-max items-center gap-[11px]">
        <BrandMark />
        <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">
          rackio
        </span>
      </div>
      <span className="flex items-center gap-2 text-[13px] tracking-[0.01em] text-muted before:h-[18px] before:w-px before:bg-border before:content-[''] max-md:hidden">
        Home rack / Main board
      </span>
      <div className="ml-auto flex items-center gap-2">
        <IconButton
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
        >
          <ThemeIcon theme={theme} />
        </IconButton>
      </div>
    </header>
  );
}
