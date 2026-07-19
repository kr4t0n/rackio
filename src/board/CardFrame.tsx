import { useRef } from "react";
import type { CardInstance, Footprint } from "@shared/types";
import type { CardDefinition } from "@/cards/registry";
import { resolveConfig } from "@/cards/registry";
import { CloseIcon, GearIcon, GripIcon } from "@/app/icons";

const FOOTPRINT_LABELS: Record<Footprint, string> = {
  small: "S",
  big: "B",
  wide: "W",
};

const chipClass =
  "grid h-10 w-10 cursor-pointer place-items-center rounded-xl border border-border " +
  "bg-[color-mix(in_oklch,var(--surface)_72%,transparent)] backdrop-blur-md " +
  "transition-[background,border-color] duration-150 " +
  "hover:bg-[color-mix(in_oklch,var(--surface)_92%,var(--fg)_6%)] " +
  "[&_svg]:h-[17px] [&_svg]:w-[17px] [&_svg]:stroke-[1.7]";

export interface CardFrameProps {
  card: CardInstance;
  definition: CardDefinition<never>;
  editMode: boolean;
  /** Hide the drag handle (mobile stacked view). */
  draggable?: boolean;
  onOpenSettings: (id: string, originRect: DOMRect) => void;
  onRemove: (id: string) => void;
  onFootprintChange: (id: string, footprint: Footprint) => void;
}

export function CardFrame({
  card,
  definition,
  editMode,
  draggable = true,
  onOpenSettings,
  onRemove,
  onFootprintChange,
}: CardFrameProps) {
  const frameRef = useRef<HTMLElement>(null);
  const config = resolveConfig(definition, card.config);
  const { Component } = definition;

  return (
    <article
      ref={frameRef}
      data-card-type={definition.type}
      data-footprint={card.footprint}
      className="card-frame @container relative h-full overflow-hidden rounded-card border border-border bg-[color-mix(in_oklch,var(--surface)_90%,transparent)] shadow-card transition-shadow duration-200"
    >
      {/* Content recedes in edit mode so the arrange affordances read clearly. */}
      <div
        className={`h-full transition-opacity duration-200 ${
          editMode ? "pointer-events-none opacity-35 select-none" : ""
        }`}
        {...(editMode ? { inert: true } : {})}
      >
        <Component
          config={config}
          footprint={card.footprint}
          instanceId={card.id}
        />
      </div>

      {editMode && (
        <>
          <div className="absolute top-3 right-3 z-10 flex gap-1.5">
            {/* Drag is pointer-only for now — keyboard moves are a planned follow-up. */}
            {draggable && (
              <span
                aria-hidden="true"
                className={`card-drag-handle ${chipClass} cursor-grab active:cursor-grabbing`}
              >
                <GripIcon />
              </span>
            )}
            <button
              type="button"
              className={chipClass}
              aria-label={`Open ${definition.name} settings`}
              onClick={(event) =>
                onOpenSettings(
                  card.id,
                  (frameRef.current ?? event.currentTarget).getBoundingClientRect(),
                )
              }
            >
              <GearIcon />
            </button>
            <button
              type="button"
              className={chipClass}
              aria-label={`Remove ${definition.name} card`}
              onClick={() => onRemove(card.id)}
            >
              <CloseIcon />
            </button>
          </div>

          <div
            className="absolute right-3 bottom-3 z-10 flex gap-[3px] rounded-xl border border-border bg-[color-mix(in_oklch,var(--surface)_72%,transparent)] p-[3px] backdrop-blur-md"
            role="group"
            aria-label={`${definition.name} card size`}
          >
            {definition.footprints.map((footprint) => (
              <button
                key={footprint}
                type="button"
                aria-pressed={card.footprint === footprint}
                aria-label={`${footprint} footprint`}
                onClick={() => onFootprintChange(card.id, footprint)}
                className={`h-8 w-8 cursor-pointer rounded-[9px] text-[11px] font-semibold tracking-[0.02em] transition-colors ${
                  card.footprint === footprint
                    ? "bg-fg text-bg"
                    : "text-muted hover:text-fg"
                }`}
              >
                {FOOTPRINT_LABELS[footprint]}
              </button>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
