/**
 * Грязь: лёгкие наносят тяжёлым удвоенный урон, если оба Отряда стоят на
 * топкой Местности. Канон: `.scratch/boevaya-sistema/spec.md:74`.
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { TERRAIN } from "./catalog/terrain.ts";
import { terrainAt } from "./movement.ts";
import type { Board, Squad } from "./state.ts";

/**
 * ×2, если атакующий лёгкий, цель тяжёлая и оба стоят на топкой Местности.
 * Обе половины фразы статьи — «тяжёлые получают ×2 от лёгких» и «лёгкие
 * наносят ×2 тяжёлым» — описывают один и тот же удар с двух сторон, не два
 * множителя: тяжёлый, бьющий лёгкого в грязи, множителя не получает.
 */
export const mudWeightFactor = (board: Board, attacker: Squad, defender: Squad): number => {
  if (!TERRAIN[terrainAt(board, attacker.hex)].muddy || !TERRAIN[terrainAt(board, defender.hex)].muddy) return 1;
  const attackerWeight = SQUAD_TYPES[attacker.type].weight;
  const defenderWeight = SQUAD_TYPES[defender.type].weight;
  return attackerWeight === "light" && defenderWeight === "heavy" ? 2 : 1;
};
