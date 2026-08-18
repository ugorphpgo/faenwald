import type { Facing, Hex } from "./state.ts";

/**
 * Математика гекс-сетки: pointy-top, раскладка odd-r.
 *
 * Направления пронумерованы по часовой стрелке от востока:
 * 0 — В, 1 — ЮВ, 2 — ЮЗ, 3 — З, 4 — СЗ, 5 — СВ.
 *
 * Направление Отряда смотрит между двумя соседними Гексами, поэтому шесть соседей
 * делятся ровно на три пары: Фронт, Фланг и Тыл.
 */

export const FACINGS: readonly Facing[] = [0, 1, 2, 3, 4, 5];

type Cube = { readonly x: number; readonly y: number; readonly z: number };

const CUBE_DIRECTIONS: readonly Cube[] = [
  { x: 1, y: -1, z: 0 }, // В
  { x: 0, y: -1, z: 1 }, // ЮВ
  { x: -1, y: 0, z: 1 }, // ЮЗ
  { x: -1, y: 1, z: 0 }, // З
  { x: 0, y: 1, z: -1 }, // СЗ
  { x: 1, y: 0, z: -1 }, // СВ
];

const toCube = (hex: Hex): Cube => {
  const x = hex.col - (hex.row - (hex.row & 1)) / 2;
  const z = hex.row;
  return { x, y: -x - z, z };
};

const toHex = (cube: Cube): Hex => ({
  col: cube.x + (cube.z - (cube.z & 1)) / 2,
  row: cube.z,
});

const add = (a: Cube, b: Cube): Cube => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

const scale = (cube: Cube, factor: number): Cube => ({
  x: cube.x * factor,
  y: cube.y * factor,
  z: cube.z * factor,
});

const direction = (facing: Facing): Cube => {
  const cube = CUBE_DIRECTIONS[facing];
  if (cube === undefined) throw new Error(`Неизвестное Направление: ${facing}`);
  return cube;
};

export const neighbour = (hex: Hex, facing: Facing): Hex =>
  toHex(add(toCube(hex), direction(facing)));

export const neighbours = (hex: Hex): readonly Hex[] =>
  FACINGS.map((facing) => neighbour(hex, facing));

export const distance = (a: Hex, b: Hex): number => {
  const from = toCube(a);
  const to = toCube(b);
  return Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y), Math.abs(from.z - to.z));
};

export const sameHex = (a: Hex, b: Hex): boolean => a.col === b.col && a.row === b.row;

const step = (facing: Facing, offset: number): Facing => (((facing + offset) % 6) + 6) % 6 as Facing;

export type Sides = {
  /** Два Гекса перед Отрядом: единственное направление его атаки и шага. */
  readonly front: readonly Hex[];
  /** Два Гекса сбоку: удар оттуда бьёт по Морали с множителем ×1,25. */
  readonly flank: readonly Hex[];
  /** Два Гекса сзади: удар оттуда бьёт по Морали с множителем ×1,5. */
  readonly rear: readonly Hex[];
};

export const sides = (hex: Hex, facing: Facing): Sides => ({
  front: [neighbour(hex, facing), neighbour(hex, step(facing, 1))],
  flank: [neighbour(hex, step(facing, 5)), neighbour(hex, step(facing, 2))],
  rear: [neighbour(hex, step(facing, 3)), neighbour(hex, step(facing, 4))],
});

/** Сторона, с которой Гекс `from` смотрит на Отряд в `hex` с Направлением `facing`. */
export const sideOf = (hex: Hex, facing: Facing, from: Hex): "front" | "flank" | "rear" | undefined => {
  const split = sides(hex, facing);
  if (split.front.some((candidate) => sameHex(candidate, from))) return "front";
  if (split.flank.some((candidate) => sameHex(candidate, from))) return "flank";
  if (split.rear.some((candidate) => sameHex(candidate, from))) return "rear";
  return undefined;
};

/** Любое Направление, чей Фронт накрывает `target`. Undefined, если Гекс не соседний. */
export const facingTowards = (from: Hex, target: Hex): Facing | undefined =>
  FACINGS.find((facing) => sides(from, facing).front.some((hex) => sameHex(hex, target)));

/**
 * Конус Навеса: клин в 60° перед Фронтом. На расстоянии d содержит d+1 Гексов,
 * поэтому глубина четыре накрывает четырнадцать.
 */
export const cone = (hex: Hex, facing: Facing, depth: number): readonly Hex[] => {
  const origin = toCube(hex);
  const left = direction(facing);
  const right = direction(step(facing, 1));
  const covered: Hex[] = [];

  for (let d = 1; d <= depth; d++) {
    for (let along = 0; along <= d; along++) {
      covered.push(toHex(add(origin, add(scale(left, d - along), scale(right, along)))));
    }
  }
  return covered;
};

export const withinBoard = (hex: Hex, board: { width: number; height: number }): boolean =>
  hex.col >= 0 && hex.row >= 0 && hex.col < board.width && hex.row < board.height;
