import { distance } from "./hex.ts";
import type { Board, BoardEdge, Hex, Side, Squad } from "./state.ts";

/** Мораль, снимаемая с союзников за гибель или Бегство соседнего Отряда. */
export const MORALE_SHOCK_ADJACENT = 10;
export const MORALE_SHOCK_NEAR = 5;
/** Мораль, которую присутствие Правителя добавляет каждому Отряду его стороны. */
export const RULER_MORALE_BONUS = 10;

/** Сколько Гексов до конкретного края Карты. */
const distanceToNamedEdge = (hex: Hex, board: Board, edge: BoardEdge): number => {
  switch (edge) {
    case "north":
      return hex.row;
    case "south":
      return board.height - 1 - hex.row;
    case "west":
      return hex.col;
    case "east":
      return board.width - 1 - hex.col;
  }
};

/**
 * Сколько Гексов Отряду до Обоза его стороны. Бежать он обязан кратчайшим
 * маршрутом, поэтому законны только шаги, уменьшающие это число.
 *
 * Карта, не объявившая Обоз, сохраняет прежнее поведение: годится любой
 * ближайший край доски. Это умолчание держит на плаву старые сюиты и партии,
 * сохранённые до тикета 08.
 */
export const distanceToEdge = (hex: Hex, board: Board, side?: Side): number => {
  const edge = side === undefined ? undefined : board.baggage?.[side];
  if (edge === undefined) {
    return Math.min(hex.col, hex.row, board.width - 1 - hex.col, board.height - 1 - hex.row);
  }
  return distanceToNamedEdge(hex, board, edge);
};

/** Отряд дошёл до Обоза своей стороны и покидает Бой. */
export const atEdge = (hex: Hex, board: Board, side?: Side): boolean => distanceToEdge(hex, board, side) === 0;

/**
 * Мораль, снимаемая с союзников погибшего или бежавшего Отряда: 10 соседям, 5
 * стоящим через Гекс. За Отряд Правителя штраф удваивается.
 */
export const moraleShock = (
  survivors: readonly Squad[],
  fallen: Squad,
): ReadonlyMap<string, number> => {
  const factor = fallen.ruler ? 2 : 1;
  const shocks = new Map<string, number>();

  for (const squad of survivors) {
    if (squad.side !== fallen.side || squad.id === fallen.id) continue;
    const range = distance(squad.hex, fallen.hex);
    const shock = range === 1 ? MORALE_SHOCK_ADJACENT : range === 2 ? MORALE_SHOCK_NEAR : 0;
    if (shock > 0) shocks.set(squad.id, shock * factor);
  }
  return shocks;
};

/** Судьба Правителя, чей Отряд уничтожен: бросок д3 по статье. */
export type RulerFate = "killed" | "captured" | "fled";

export const rulerFateFromRoll = (roll: number): RulerFate =>
  roll === 1 ? "killed" : roll === 2 ? "captured" : "fled";

export const sideOpposing = (side: Side): Side => (side === "blue" ? "red" : "blue");
