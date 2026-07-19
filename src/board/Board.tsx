/**
 * Board chrome for M0: blueprint background, heading, and static placeholder
 * cards demonstrating the card frame + grid metrics. The real grid engine
 * (drag, footprints, persistence) replaces the placeholders in M1.
 */

function PlaceholderCard({
  title,
  state,
  caption,
  className = "",
}: {
  title: string;
  state: string;
  caption: string;
  className?: string;
}) {
  return (
    <article
      className={`relative flex min-h-[248px] flex-col overflow-hidden rounded-card border border-border bg-[color-mix(in_oklch,var(--surface)_90%,transparent)] p-[22px] shadow-card ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
          {title}
        </h2>
        <span
          aria-label="Ready"
          className="h-2 w-2 rounded-full bg-success shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-success)_14%,transparent)]"
        />
      </div>
      <div className="mt-auto pt-8">
        <p className="m-0 text-[22px] leading-[1.2] tracking-[-0.02em]">
          {state}
        </p>
        <p className="m-0 mt-[7px] max-w-[30ch] text-xs tracking-[0.01em] text-muted">
          {caption}
        </p>
      </div>
    </article>
  );
}

export function Board() {
  return (
    <main className="board-blueprint relative min-h-[calc(100dvh-68px)] p-[clamp(18px,3vw,42px)]">
      <div className="mx-auto mb-[22px] flex max-w-360 items-end justify-between gap-6 max-md:flex-col max-md:items-start">
        <div>
          <p className="m-0 mb-[5px] text-[11px] font-semibold tracking-[0.09em] uppercase text-accent">
            Live board
          </p>
          <h1 className="m-0 font-display text-[clamp(28px,4vw,44px)] leading-[1.05] font-semibold tracking-[-0.025em]">
            Your rack, at a glance.
          </h1>
          <p className="m-0 mt-[7px] max-w-[58ch] text-sm text-muted">
            Cards for every service on the rack — drag them into the layout
            that fits how you check in.
          </p>
        </div>
      </div>

      <section
        aria-label="Rackio service cards"
        className="mx-auto grid min-h-[620px] max-w-360 auto-rows-[72px] grid-cols-12 items-stretch gap-4 max-md:flex max-md:min-h-0 max-md:flex-col"
      >
        <PlaceholderCard
          title="Rack health"
          state="Ready to connect"
          caption="Add your first monitoring service to surface health signals here."
          className="col-span-4 row-span-3 max-lg:col-span-6"
        />
        <PlaceholderCard
          title="Storage"
          state="No source yet"
          caption="Storage cards will inherit the same three responsive footprints."
          className="col-span-4 row-span-3 max-lg:col-span-6"
        />
      </section>
    </main>
  );
}
