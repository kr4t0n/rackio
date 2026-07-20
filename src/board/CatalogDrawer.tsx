import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Footprint } from "@shared/types";
import { listCardDefinitions } from "@/cards/registry";
import { CloseIcon, PlusIcon } from "@/app/icons";

const FOOTPRINT_HINTS: Record<Footprint, string> = {
  small: "2×2",
  big: "4×4",
  wide: "4×2",
};

interface CatalogDrawerProps {
  open: boolean;
  /** Instances currently on the board, keyed by card type (for maxInstances). */
  countByType: Readonly<Record<string, number>>;
  onAdd: (type: string) => void;
  onClose: () => void;
}

/** "Add card" drawer — lists registered card types, slides in from the right. */
export function CatalogDrawer({
  open,
  countByType,
  onAdd,
  onClose,
}: CatalogDrawerProps) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Add a card">
          <motion.div
            className="absolute inset-0 bg-[color-mix(in_oklch,var(--bg)_55%,transparent)] backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute inset-y-3 right-3 flex w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-[20px] border border-border bg-surface shadow-[0_28px_90px_color-mix(in_oklch,var(--bg)_78%,transparent)]"
            initial={reducedMotion ? { opacity: 0 } : { x: "calc(100% + 12px)" }}
            animate={reducedMotion ? { opacity: 1 } : { x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { x: "calc(100% + 12px)" }}
            transition={
              reducedMotion
                ? { duration: 0.15 }
                : { type: "spring", duration: 0.45, bounce: 0.12 }
            }
          >
            <div className="flex items-start justify-between gap-3.5 border-b border-border p-5">
              <div>
                <p className="m-0 mb-[3px] font-mono text-[10px] font-[550] tracking-[0.08em] uppercase text-muted">
                  Card catalog
                </p>
                <h2 className="m-0 font-display text-xl leading-[1.1] font-semibold tracking-[-0.02em]">
                  Add a card
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close catalog"
                onClick={onClose}
                className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_4%)] transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_76%,var(--fg)_10%)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.7]"
              >
                <CloseIcon />
              </button>
            </div>

            <div className="flex flex-col gap-3 overflow-y-auto p-5">
              {listCardDefinitions().map((definition) => {
                const atLimit =
                  definition.maxInstances !== undefined &&
                  (countByType[definition.type] ?? 0) >= definition.maxInstances;
                return (
                <div
                  key={definition.type}
                  className="rounded-2xl border border-border bg-[color-mix(in_oklch,var(--bg)_30%,var(--surface)_70%)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="m-0 text-[15px] font-semibold tracking-[-0.01em]">
                      {definition.name}
                    </h3>
                    <button
                      type="button"
                      aria-label={`Add ${definition.name} card`}
                      disabled={atLimit}
                      onClick={() => onAdd(definition.type)}
                      className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_4%)] px-3.5 text-[12px] font-[550] tracking-[0.02em] transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_76%,var(--fg)_10%)] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_4%)] [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:stroke-[1.9]"
                    >
                      {atLimit ? "On the board" : (
                        <>
                          <PlusIcon />
                          Add
                        </>
                      )}
                    </button>
                  </div>
                  <p className="m-0 mt-1 text-[13px] text-muted">
                    {definition.description}
                  </p>
                  <div className="mt-2.5 flex gap-1.5">
                    {definition.footprints.map((footprint) => (
                      <span
                        key={footprint}
                        className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-muted"
                      >
                        {footprint} {FOOTPRINT_HINTS[footprint]}
                      </span>
                    ))}
                  </div>
                </div>
                );
              })}
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
