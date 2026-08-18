/**
 * Уровни высоты. Статья описывает холм и предхолмье четырьмя отдельными
 * строками, но все они — одна функция разницы уровней: каждая ступень вверх
 * даёт бьющему четверть сверху, каждая ступень вниз — четверть снизу, а через
 * две ступени шаг вдвое шире.
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { TERRAIN } from "./catalog/terrain.ts";
import { terrainAt } from "./movement.ts";
import type { Board, Hex, Squad } from "./state.ts";

export const elevationAt = (board: Board, hex: Hex): number => TERRAIN[terrainAt(board, hex)].elevation;

/**
 * Множитель Урона за разницу уровней между атакующим и целью:
 * +1 → ×1,25, +2 → ×1,5, −1 → ×0,75, −2 → ×0,5.
 */
export const elevationFactor = (attackerElevation: number, defenderElevation: number): number => {
  const diff = attackerElevation - defenderElevation;
  if (diff >= 2) return 1.5;
  if (diff === 1) return 1.25;
  if (diff === -1) return 0.75;
  if (diff <= -2) return 0.5;
  return 1;
};

/**
 * Множитель высоты для конкретного Удара. Дальнобойные его не получают вовсе:
 * «находясь на холме, не получает его бонусы и дебафы к атаке» — высота даёт им
 * не силу, а дальность.
 */
export const strikeElevationFactor = (board: Board, attacker: Squad, defender: Squad): number => {
  if (SQUAD_TYPES[attacker.type].branch === "ranged") return 1;
  return elevationFactor(elevationAt(board, attacker.hex), elevationAt(board, defender.hex));
};

/** Подъём стоит вдвое: любой шаг на Гекс выше того, с которого идут. */
export const climbFactor = (board: Board, from: Hex, to: Hex): number =>
  elevationAt(board, to) > elevationAt(board, from) ? 2 : 1;

/**
 * Добавка к дальности стрельбы за высоту: +1 Гекс на предхолмье, +2 на холме.
 * Конный лучник бонусов за холм не получает вовсе.
 */
export const rangeBonus = (board: Board, shooter: Squad): number => {
  if (SQUAD_TYPES[shooter.type].omniDirectional === true) return 0;
  return elevationAt(board, shooter.hex);
};
