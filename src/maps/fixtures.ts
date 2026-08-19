/**
 * Фикстуры Карт. Карта — самодостаточный артефакт: размеры, Местность, Зоны
 * расстановки и края Обоза обеих сторон (`CONTEXT.md`, `docs/adr/0007`).
 *
 * Пока их пишут руками: редактор карт отложен за горизонт v1, а для первых
 * партий хватает нескольких полей. Модуль намеренно лежит вне `src/rules/` —
 * это данные, а не правила, и ядро о нём не знает.
 *
 * Хранятся как TypeScript, а не JSON: проект исполняет TS напрямую, поэтому
 * готовые карты заодно проходят проверку типов, а не превращаются в `any` на
 * границе импорта.
 */

import type { Board, Hex, TerrainId } from "../rules/index.ts";

const key = (hex: Hex): string => `${hex.col},${hex.row}`;

/** Все Гексы полосы строк [from, to] по всей ширине Карты. */
const rowBand = (width: number, from: number, to: number): readonly Hex[] => {
  const hexes: Hex[] = [];
  for (let row = from; row <= to; row++) {
    for (let col = 0; col < width; col++) hexes.push({ col, row });
  }
  return hexes;
};

const paint = (hexes: readonly Hex[], terrain: TerrainId): Readonly<Record<string, TerrainId>> =>
  Object.fromEntries(hexes.map((hex) => [key(hex), terrain]));

const WIDTH = 12;
const HEIGHT = 12;

/**
 * Ровное поле: ничего, кроме двух полос расстановки у северного и южного краёв.
 * Базовая карта для проверки правил без влияния Местности.
 */
export const OPEN_FIELD: Board = {
  width: WIDTH,
  height: HEIGHT,
  deployment: {
    blue: rowBand(WIDTH, 0, 2),
    red: rowBand(WIDTH, HEIGHT - 3, HEIGHT - 1),
  },
  baggage: { blue: "north", red: "south" },
};

/**
 * Холм в центре и подступы через грязь с запада, лес с востока: карта, на
 * которой разом играют Уровень, весовое правило грязи и лесные правила
 * стрельбы.
 */
export const HILL_AND_THICKET: Board = {
  width: WIDTH,
  height: HEIGHT,
  terrain: {
    ...paint(rowBand(WIDTH, 5, 6).filter((hex) => hex.col >= 4 && hex.col <= 7), "foothill"),
    ...paint([{ col: 5, row: 5 }, { col: 6, row: 5 }, { col: 5, row: 6 }, { col: 6, row: 6 }], "hill"),
    ...paint([{ col: 1, row: 5 }, { col: 1, row: 6 }, { col: 2, row: 5 }, { col: 2, row: 6 }], "mud"),
    ...paint([{ col: 9, row: 4 }, { col: 9, row: 5 }, { col: 10, row: 4 }, { col: 10, row: 5 }], "forest"),
  },
  deployment: {
    blue: rowBand(WIDTH, 0, 2),
    red: rowBand(WIDTH, HEIGHT - 3, HEIGHT - 1),
  },
  baggage: { blue: "north", red: "south" },
};

export const MAPS: Readonly<Record<string, Board>> = {
  openField: OPEN_FIELD,
  hillAndThicket: HILL_AND_THICKET,
};
