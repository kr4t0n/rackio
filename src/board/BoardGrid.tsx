import { useMemo } from "react";
import { GridLayout, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import type { BoardState, Footprint } from "@shared/types";
import { FOOTPRINT_SPANS } from "@shared/types";
import { getCardDefinition } from "@/cards/registry";
import { CardFrame } from "./CardFrame";
import { BOARD_COLS, BOARD_GAP, computeCellSize } from "./grid-math";

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
  const cellSize = computeCellSize(width);

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
    <div ref={containerRef} className="mx-auto min-h-[620px] max-w-360">
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: BOARD_COLS,
            rowHeight: cellSize,
            margin: [BOARD_GAP, BOARD_GAP],
            containerPadding: [0, 0],
          }}
          dragConfig={{
            enabled: editMode,
            handle: ".card-drag-handle",
          }}
          resizeConfig={{ enabled: false }}
          onLayoutChange={(next) =>
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
