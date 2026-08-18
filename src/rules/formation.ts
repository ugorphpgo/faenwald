/**
 * Сомкнутый строй копейщиков: вычисляется заново на каждый Удар, а не хранится
 * как флаг на Отряде — разворот соседа рвёт строй сам собой, без отдельного
 * правила «строй разрывается».
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { TERRAIN } from "./catalog/terrain.ts";
import { sameHex, sides, withinBoard } from "./hex.ts";
import { isPassable, terrainAt } from "./movement.ts";
import type { Board, Hex, Season, Squad } from "./state.ts";

const isSpearman = (squad: Squad): boolean => SQUAD_TYPES[squad.type].branch === "spearmen";

/** Фланг прикрыт другим копейщиком с тем же Направлением, непроходимой
 *  Местностью (зимняя вода в их число не входит — она проходима) или краем
 *  карты. */
const flankCovered = (board: Board, squads: readonly Squad[], squad: Squad, flankHex: Hex, season: Season): boolean => {
  if (!withinBoard(flankHex, board) || !isPassable(board, flankHex, season)) return true;
  const neighbour = squads.find((candidate) => sameHex(candidate.hex, flankHex));
  return neighbour !== undefined && isSpearman(neighbour) && neighbour.facing === squad.facing;
};

/** Сколько Флангов копейщика прикрыто: 0, 1 или 2. Не копейщик — всегда 0. */
export const shieldWallCoverage = (board: Board, squads: readonly Squad[], squad: Squad, season: Season): 0 | 1 | 2 => {
  if (!isSpearman(squad)) return 0;
  const covered = sides(squad.hex, squad.facing).flank.filter((hex) => flankCovered(board, squads, squad, hex, season));
  return covered.length as 0 | 1 | 2;
};

/**
 * Множитель входящего урона с Фронта: ×0,8 с одним прикрытым Флангом, ×0,6 с
 * двумя. Поселение усиливает бонус на 5 процентных пунктов (статья:
 * «Копейщики — +5% бонуса за сомкнутый строй»).
 */
export const shieldWallFactor = (board: Board, squads: readonly Squad[], squad: Squad, season: Season): number => {
  const coverage = shieldWallCoverage(board, squads, squad, season);
  if (coverage === 0) return 1;
  const bonus = TERRAIN[terrainAt(board, squad.hex)].shieldWallBonus ?? 0;
  return (coverage === 1 ? 0.8 : 0.6) - bonus;
};

/** Копейщик получает дополнительный ×1,5 физического урона в Тыл — черта
 *  Рода войск, не зависит от текущего прикрытия Флангов. */
export const rearVulnerabilityFactor = (squad: Squad): number => (isSpearman(squad) ? 1.5 : 1);

/**
 * Отражает ли защитник урон Таранного удара обратно в атакующего: копейщик,
 * атакованный во Фронт и имеющий бонус Сомкнутого строя.
 *
 * Отражение «не считается атакой» — поэтому оно не тратит Атаку защитника, не
 * вызывает встречной Контратаки и, в отличие от Контратаки, переживает Бегство
 * отражающего.
 */
export const reflectsCharge = (
  board: Board,
  squads: readonly Squad[],
  defender: Squad,
  side: "front" | "flank" | "rear",
  attackerIsCharging: boolean,
  season: Season,
): boolean =>
  attackerIsCharging &&
  side === "front" &&
  isSpearman(defender) &&
  shieldWallCoverage(board, squads, defender, season) > 0;
