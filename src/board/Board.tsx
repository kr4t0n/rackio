import { useCallback, useEffect, useState } from "react";
import type { Footprint } from "@shared/types";
import { announce } from "@/app/announcer";
import { CompactButton } from "@/app/controls";
import { CheckIcon, PencilIcon, PlusIcon } from "@/app/icons";
import { getCardDefinition } from "@/cards/registry";
import { BoardGrid } from "./BoardGrid";
import { CardFrame } from "./CardFrame";
import { CatalogDrawer } from "./CatalogDrawer";
import type { SettingsTarget } from "./SettingsOverlay";
import { SettingsOverlay } from "./SettingsOverlay";
import { generateCardId, nextFreeRow } from "./state";
import { useBoardState } from "./useBoardState";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

const MOBILE_FOOTPRINT_CLASS: Record<Footprint, string> = {
  small: "w-[min(100%,240px)] aspect-square",
  big: "w-[min(100%,500px)] aspect-square",
  wide: "w-[min(100%,500px)] aspect-[2/1]",
};

export function Board() {
  const { board, dispatch, ready } = useBoardState();
  const [editMode, setEditMode] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<SettingsTarget | null>(
    null,
  );
  const isMobile = useIsMobile();

  const addCard = useCallback(
    (type: string) => {
      const definition = getCardDefinition(type);
      if (!definition) return;
      dispatch({
        kind: "add",
        card: {
          id: generateCardId(),
          type,
          footprint: definition.defaultFootprint,
          x: 0,
          y: nextFreeRow(board),
          config: definition.defaultConfig as Record<string, unknown>,
        },
      });
      setEditMode(true);
      announce(`${definition.name} card added to the board.`);
    },
    [board, dispatch],
  );

  const removeCard = useCallback(
    (id: string) => {
      dispatch({ kind: "remove", id });
      announce("Card removed from the board.");
    },
    [dispatch],
  );

  const changeFootprint = useCallback(
    (id: string, footprint: Footprint) => {
      dispatch({ kind: "set-footprint", id, footprint });
      announce(`Card footprint changed to ${footprint}.`);
    },
    [dispatch],
  );

  const openSettings = useCallback(
    (id: string, originRect: DOMRect) => {
      const card = board.cards.find((c) => c.id === id);
      const definition = card && getCardDefinition(card.type);
      if (!card || !definition) return;
      setSettingsTarget({ card, definition, originRect });
    },
    [board.cards],
  );

  const saveSettings = useCallback(
    (id: string, config: Record<string, unknown>) => {
      dispatch({ kind: "set-config", id, config });
      setSettingsTarget(null);
      announce("Card settings saved.");
    },
    [dispatch],
  );

  const sortedCards = [...board.cards].sort((a, b) => a.y - b.y || a.x - b.x);

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
            {isMobile
              ? "Cards stack on small screens — arrange the layout from a larger one."
              : editMode
                ? "Drag by the handle, switch footprints, or open settings from the gear."
                : "Cards for every service on the rack. Switch to edit mode to arrange them."}
          </p>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2">
            {editMode && (
              <CompactButton onClick={() => setCatalogOpen(true)}>
                <PlusIcon />
                <span>Add card</span>
              </CompactButton>
            )}
            <CompactButton
              aria-pressed={editMode}
              onClick={() => {
                setEditMode((on) => {
                  announce(on ? "Edit mode off." : "Edit mode on.");
                  return !on;
                });
              }}
              className={
                editMode ? "!bg-fg !text-bg hover:!bg-fg hover:!text-bg" : ""
              }
            >
              {editMode ? <CheckIcon /> : <PencilIcon />}
              <span>{editMode ? "Done" : "Edit board"}</span>
            </CompactButton>
          </div>
        )}
      </div>

      {!ready ? (
        <section aria-label="Rackio service cards" className="min-h-[620px]" />
      ) : isMobile ? (
        <section
          aria-label="Rackio service cards"
          className="flex flex-col gap-4"
        >
          {sortedCards.map((card) => {
            const definition = getCardDefinition(card.type);
            if (!definition) return null;
            return (
              <div key={card.id} className={MOBILE_FOOTPRINT_CLASS[card.footprint]}>
                <CardFrame
                  card={card}
                  definition={definition}
                  editMode={false}
                  draggable={false}
                  onOpenSettings={openSettings}
                  onRemove={removeCard}
                  onFootprintChange={changeFootprint}
                />
              </div>
            );
          })}
        </section>
      ) : (
        <section aria-label="Rackio service cards">
          <BoardGrid
            board={board}
            editMode={editMode}
            onPositionsChange={(positions) =>
              dispatch({ kind: "set-positions", positions })
            }
            onOpenSettings={openSettings}
            onRemove={removeCard}
            onFootprintChange={changeFootprint}
          />
        </section>
      )}

      <CatalogDrawer
        open={catalogOpen}
        countByType={board.cards.reduce<Record<string, number>>(
          (counts, card) => {
            counts[card.type] = (counts[card.type] ?? 0) + 1;
            return counts;
          },
          {},
        )}
        onAdd={addCard}
        onClose={() => setCatalogOpen(false)}
      />
      <SettingsOverlay
        target={settingsTarget}
        onSave={saveSettings}
        onClose={() => setSettingsTarget(null)}
      />
    </main>
  );
}
