import { useMemo } from "react";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { BoardState, Footprint } from "@shared/types";
import { FOOTPRINT_SPANS } from "@shared/types";
import { getCardDefinition } from "@/cards/registry";
import { CardFrame } from "./CardFrame";
import { BOARD_GAP, computeCellSize, computeColumns } from "./grid-math";

interface BoardGridProps {
  board: BoardState;
  editMode: boolean;
  onPositionsChange: (
    positions: ReadonlyArray<{ id: string; x: number; y: number }>,
  ) => void;
  onOpenSettings: (id: string, originRect: DOMRect) => void;
  onRemove: (id: string) => void;
  onFootprintChange: (id: string, footprint: Footprint) => void;
}

export function BoardGrid({
  board,
  editMode,
  onPositionsChange,
  onOpenSettings,
  onRemove,
  onFootprintChange,
}: BoardGridProps) {
  const { width, mounted, containerRef } = useContainerWidth();
  // Columns follow the width so cards keep their size and a bigger board
  // simply holds more of them.
  const cols = computeColumns(width);
  const cellSize = computeCellSize(width, cols);

  const layout: Layout = useMemo(
    () =>
      board.cards.map((card) => ({
        i: card.id,
        x: card.x,
        y: card.y,
        ...FOOTPRINT_SPANS[card.footprint],
      })),
    [board.cards],
  );

  return (
    <div ref={containerRef} className="min-h-[620px]">
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols,
            rowHeight: cellSize,
            margin: [BOARD_GAP, BOARD_GAP],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: editMode,
            handle: ".card-drag-handle",
          }}
          resizeConfig={{ enabled: false }}
          // Persist on drag stop, NOT onLayoutChange. With a variable column
          // count, opening a wide board on a narrow screen makes RGL clamp
          // x into range and fire a layout change — saving that would
          // permanently squash the wide arrangement. Reflow after add /
          // remove / footprint changes is deterministic from the stored
          // positions, so it doesn't need persisting; the next real drag
          // writes the settled layout anyway.
          onDragStop={(next) =>
            onPositionsChange(next.map(({ i, x, y }) => ({ id: i, x, y })))
          }
        >
          {board.cards.map((card) => {
            const definition = getCardDefinition(card.type);
            if (!definition) return null;
            return (
              <div key={card.id}>
                <CardFrame
                  card={card}
                  definition={definition}
                  editMode={editMode}
                  onOpenSettings={onOpenSettings}
                  onRemove={onRemove}
                  onFootprintChange={onFootprintChange}
                />
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}
