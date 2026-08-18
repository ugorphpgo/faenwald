/**
 * Детерминированный генератор случайных чисел. Живёт внутри состояния Боя, чтобы
 * партия воспроизводилась по зерну и журналу — от этого зависят и отладка, и
 * будущий сетевой арбитраж.
 */

export type RngState = { readonly seed: number };

export const seedRng = (seed: number): RngState => ({ seed: seed >>> 0 });

/** mulberry32: возвращает число в [0, 1) и следующее состояние генератора. */
const next = (state: RngState): { value: number; state: RngState } => {
  let a = (state.seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  return { value, state: { seed: a } };
};

/** Бросок кости на `sides` граней: целое в диапазоне 1..sides. */
export const roll = (state: RngState, sides: number): { value: number; state: RngState } => {
  const drawn = next(state);
  return { value: Math.floor(drawn.value * sides) + 1, state: drawn.state };
};
