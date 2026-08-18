/**
 * Конвейер урона. Порядок шагов задан статьёй и обязателен:
 *
 * 1. базовый Урон Типа, приведённый к Численности;
 * 2. половина, если атакующий ниже половины Здоровья;
 * 3. перемножение всех модификаторов;
 * 4. Предельный урон — не более ×3 от естественного;
 * 5. округление до целого по правилам арифметики.
 *
 * Моральный урон считается тем же конвейером, но со своими добавочными
 * множителями (сторона удара) и может быть выведен из-под потолка — так статья
 * поступает с моральным уроном кавалерии.
 */

import { scaleToHeadcount } from "./scale.ts";

export type DamageInput = {
  /** Естественный Урон Типа на сотню солдат. */
  readonly naturalDamage: number;
  readonly headcount: number;
  /** Здоровье атакующего сейчас и его максимум — для правила половины. */
  readonly health: number;
  readonly maxHealth: number;
  /** Множители, общие для физического и морального урона. */
  readonly modifiers: readonly number[];
  /** Добавочные множители только для физического урона — Мораль не трогают
   *  (например, ×1,5 в Тыл копейщика: «моральный урон дополнительно не
   *  увеличивается»). */
  readonly healthModifiers?: readonly number[];
  /** Добавочные множители только для морального урона. */
  readonly moraleModifiers: readonly number[];
  /** Вывести моральный урон из-под Предельного урона. */
  readonly moraleExemptFromCap: boolean;
};

export type DamageOutput = {
  readonly health: number;
  readonly morale: number;
};

/** Предельный урон: не более ×3 от естественного. */
export const DAMAGE_CAP_FACTOR = 3;

const product = (factors: readonly number[]): number =>
  factors.reduce((total, factor) => total * factor, 1);

/** Округление до целого по правилам арифметики: половина уходит от нуля. */
const arithmeticRound = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

export const resolveDamage = (input: DamageInput): DamageOutput => {
  const natural = scaleToHeadcount(input.naturalDamage, input.headcount);
  // «Сохраняет показатели урона, пока не потеряет половину здоровья; дальше
  // наносит половину». На ровно половине потеря половины уже наступила —
  // отсюда `<=`, а не `<`.
  const weakened = input.health <= input.maxHealth / 2 ? natural / 2 : natural;
  const cap = natural * DAMAGE_CAP_FACTOR;

  const shared = weakened * product(input.modifiers);
  const health = shared * product(input.healthModifiers ?? []);
  const morale = shared * product(input.moraleModifiers);

  return {
    health: Math.max(0, arithmeticRound(Math.min(health, cap))),
    morale: Math.max(0, arithmeticRound(input.moraleExemptFromCap ? morale : Math.min(morale, cap))),
  };
};
