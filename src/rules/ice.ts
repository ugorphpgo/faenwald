/**
 * Провал льда: зимняя вода трескается под Отрядом, входящим на неё. Шанс
 * зависит от Рода войск и веса, урон и откат — фиксированные величины статьи.
 * Канон: `.scratch/boevaya-sistema/spec.md:80`.
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import type { Squad } from "./state.ts";

/** Доля максимума Здоровья, которую отнимает провал. */
export const ICE_CRACK_DAMAGE_FRACTION = 0.5;

/**
 * Шанс провала в процентах (0..100), сравнивается с броском d100. Статья даёт
 * числа и по весу, и по Роду войск одновременно — «тяжёлые 10%» и «тяжёлая
 * кавалерия 25%» пересекаются. Читается так: кавалерия смотрит на свои
 * кавалерийские строки, все остальные — на весовые.
 */
export const iceCrackChancePercent = (squad: Squad): number => {
  const type = SQUAD_TYPES[squad.type];
  if (type.branch === "cavalry") return type.weight === "heavy" ? 25 : 15;
  return type.weight === "heavy" ? 10 : 5;
};
