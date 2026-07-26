import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardInstance } from "@shared/types";
import type { CardDefinition } from "@/cards/registry";
import { resolveConfig } from "@/cards/registry";
import { CloseIcon } from "@/app/icons";

export interface SettingsTarget {
  card: CardInstance;
  definition: CardDefinition<never>;
  originRect: DOMRect;
}

interface SettingsOverlayProps {
  target: SettingsTarget | null;
  onSave: (id: string, config: Record<string, unknown>) => void;
  onClose: () => void;
}

const PANEL_WIDTH = 480;

/**
 * Flip-to-center card settings: the panel launches from the card's position,
 * flipping over as it travels to the viewport center — one consistent settings
 * surface regardless of the card's footprint. Reduced motion gets a plain fade.
 */
export function SettingsOverlay({
  target,
  onSave,
  onClose,
}: SettingsOverlayProps) {
  return createPortal(
    <AnimatePresence>
      {target && (
        <SettingsPanel
          key={target.card.id}
          target={target}
          onSave={onSave}
          onClose={onClose}
        />
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Tracks whether the settings body actually overflows, so the pinned action
 * row only grows a divider when there's something scrolled under it. Watches
 * the content too — connecting an integration swaps a tall form for a short one.
 */
function useOverflow() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    const content = contentRef.current;
    if (!node || !content) return;
    const measure = () => setScrollable(node.scrollHeight > node.clientHeight + 1);
    measure();
    // Both ends move: the viewport resizes the scroller, and the form itself
    // grows or shrinks as queries resolve.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return { scrollRef, contentRef, scrollable };
}

function SettingsPanel({
  target,
  onSave,
  onClose,
}: {
  target: SettingsTarget;
  onSave: (id: string, config: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { card, definition, originRect } = target;
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<never>(() =>
    resolveConfig(definition, card.config),
  );
  const { Settings } = definition;
  const { scrollRef, contentRef, scrollable } = useOverflow();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const originCenterX = originRect.left + originRect.width / 2;
  const originCenterY = originRect.top + originRect.height / 2;
  const cardOffset = {
    x: originCenterX - window.innerWidth / 2,
    y: originCenterY - window.innerHeight / 2,
    scale: Math.min(1, originRect.width / PANEL_WIDTH),
    rotateY: -180,
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${definition.name} settings`}
    >
      <motion.div
        className="absolute inset-0 bg-[color-mix(in_oklch,var(--bg)_72%,transparent)] backdrop-blur-lg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      {/* Fade lives on this shell, never on the 3D element below: opacity < 1
          forces the browser to flatten a preserve-3d context, which breaks
          backface culling and shows mirrored settings mid-flight. The exit
          fade is delayed so the panel dissolves just before landing on the
          card instead of materializing on top of it. */}
      <motion.div
        className="relative w-[min(480px,100%)] perspective-[1600px]"
        initial={{ opacity: reducedMotion ? 0 : 1 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: 0,
          transition: reducedMotion
            ? { duration: 0.15 }
            : { duration: 0.16, delay: 0.26, ease: "easeOut" },
        }}
      >
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        className="outline-none transform-3d"
        initial={reducedMotion ? false : cardOffset}
        animate={
          reducedMotion ? undefined : { x: 0, y: 0, scale: 1, rotateY: 0 }
        }
        exit={reducedMotion ? undefined : "flipBackToCard"}
        variants={{
          // Resolved at exit time, when the panel is measurable: squash to the
          // card's exact rectangle (matters for wide cards, whose silhouette
          // is far from the panel's) instead of scaling uniformly.
          flipBackToCard: () => ({
            x: cardOffset.x,
            y: cardOffset.y,
            scaleX:
              originRect.width / (panelRef.current?.offsetWidth ?? PANEL_WIDTH),
            scaleY:
              originRect.height /
              (panelRef.current?.offsetHeight ?? PANEL_WIDTH),
            rotateY: -180,
            transition: { type: "spring", duration: 0.5, bounce: 0 },
          }),
        }}
        transition={{ type: "spring", duration: 0.55, bounce: 0.16 }}
      >
        {/* Card back — visible during the first half of the flip. */}
        {!reducedMotion && (
          <div
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center rounded-[20px] border border-border bg-surface backface-hidden rotate-y-180"
          >
            <span className="grid h-10 w-10 -rotate-2 grid-cols-2 gap-1 rounded-xl border border-[color-mix(in_oklch,var(--fg)_24%,transparent)] p-[7px] opacity-40">
              <span className="rounded-[3px] bg-fg" />
              <span className="rounded-[3px] bg-fg" />
              <span className="rounded-[3px] bg-fg" />
              <span className="rounded-[3px] bg-fg" />
            </span>
          </div>
        )}

        {/* Header and actions are pinned; only the settings body scrolls, so
            Save stays reachable no matter how tall a card's form is. The panel
            still sizes to its content — the cap only bites on long forms. */}
        <div className="flex max-h-[min(760px,calc(100dvh-32px))] flex-col rounded-[20px] border border-border bg-surface shadow-[0_28px_90px_color-mix(in_oklch,var(--bg)_78%,transparent)] backface-hidden">
          <div className="flex shrink-0 items-start justify-between gap-3.5 p-6 pb-5">
            <div>
              <p className="m-0 mb-[3px] font-mono text-[10px] font-[550] tracking-[0.08em] uppercase text-muted">
                Card settings
              </p>
              <h2 className="m-0 font-display text-2xl leading-[1.1] font-semibold tracking-[-0.02em]">
                {definition.name}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              onClick={onClose}
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_86%,var(--fg)_4%)] transition-colors hover:bg-[color-mix(in_oklch,var(--surface)_76%,var(--fg)_10%)] [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.7]"
            >
              <CloseIcon />
            </button>
          </div>

          <div
            ref={scrollRef}
            data-settings-scroll
            className="min-h-0 flex-1 overflow-y-auto px-6"
          >
            <div ref={contentRef}>
              <Settings
                draft={draft}
                onChange={setDraft}
                instanceId={card.id}
              />
            </div>
          </div>

          <div
            className={`flex shrink-0 justify-end gap-2 p-6 pt-5 ${
              scrollable ? "border-t border-border" : ""
            }`}
          >
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 cursor-pointer rounded-xl border border-border bg-transparent px-4 text-[13px] font-[550] tracking-[0.02em] text-muted transition-colors hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                const parsed = definition.configSchema.safeParse(draft);
                if (parsed.success) {
                  onSave(card.id, parsed.data as Record<string, unknown>);
                }
              }}
              className="min-h-11 cursor-pointer rounded-xl border border-transparent bg-fg px-5 text-[13px] font-[550] tracking-[0.02em] text-bg transition-opacity hover:opacity-90"
            >
              Save
            </button>
          </div>
        </div>
      </motion.div>
      </motion.div>
    </div>
  );
}
