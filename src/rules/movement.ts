import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { TERRAIN } from "./catalog/terrain.ts";
import type { Terrain, TerrainId } from "./catalog/terrain.ts";
import { sameHex, sides, withinBoard } from "./hex.ts";
import type { Board, Hex, Season, Squad } from "./state.ts";

/** Цена Ускорения в Морали. */
export const SURGE_MORALE_COST = 10;

export const terrainAt = (board: Board, hex: Hex): TerrainId => board.terrain?.[`${hex.col},${hex.row}`] ?? "plain";

/** Вода зимой — равнина с сохранённым идентификатором: Провал льда (см. тикет
 *  02) должен опознать её как воду, но правила прохода и построения читают её
 *  как обычную равнину. */
const WINTER_WATER: Terrain = { ...TERRAIN.plain, id: "water" };

export const effectiveTerrain = (board: Board, hex: Hex, season: Season): Terrain => {
  const id = terrainAt(board, hex);
  return id === "water" && season === "winter" ? WINTER_WATER : TERRAIN[id];
};

const isCavalry = (squad: Squad): boolean => SQUAD_TYPES[squad.type].branch === "cavalry";
const isSpearman = (squad: Squad): boolean => SQUAD_TYPES[squad.type].branch === "spearmen";

/**
 * Копейщик умеет шагать на свой Фланг или Тыл без разворота — вдвое дороже
 * обычного. Возвращает множитель к стоимости Гекса, если `to` лежит на одной
 * из этих сторон; `undefined`, если это не копейщик или Гекс не сбоку/сзади
 * (в этом случае решает обычная проверка Фронта).
 */
export const spearmanSidewaysFactor = (squad: Squad, to: Hex): number | undefined => {
  if (!isSpearman(squad)) return undefined;
  const split = sides(squad.hex, squad.facing);
  const sideways = [...split.flank, ...split.rear];
  return sideways.some((hex) => sameHex(hex, to)) ? 2 : undefined;
};

/**
 * Стоимость входа в Гекс. Заросли берут с кавалерии фиксированные два Гекса, дорога
 * половину, грязь вдвое, топь втрое. Подъём на уровень выше удваивает итог —
 * поэтому стоимость зависит и от Гекса, с которого шагают.
 */
export const stepCost = (board: Board, squad: Squad, from: Hex, to: Hex, season: Season): number => {
  const terrain = effectiveTerrain(board, to, season);
  const base = isCavalry(squad) && terrain.cavalryCost !== undefined ? terrain.cavalryCost : terrain.costFactor;
  const climb = terrain.elevation > effectiveTerrain(board, from, season).elevation ? 2 : 1;
  return base * climb;
};

export const isPassable = (board: Board, hex: Hex, season: Season): boolean =>
  withinBoard(hex, board) && effectiveTerrain(board, hex, season).passable;

/** Лес запрещает кавалерии Ускорение. */
export const surgeBlocked = (board: Board, squad: Squad): boolean =>
  isCavalry(squad) && (TERRAIN[terrainAt(board, squad.hex)].blocksSurgeForCavalry ?? false);

/** Лес ограничивает кавалерию одним Гексом за Ход: остаток сгорает после шага. */
export const stepEndsMovement = (board: Board, squad: Squad, to: Hex): boolean =>
  isCavalry(squad) && (TERRAIN[terrainAt(board, to)].capsCavalryToOneStep ?? false);

/**
 * Запас хода, выдаваемый Отряду в начале его Хода.
 *
 * Сколько переносится с прошлого Хода — решает политика
 * `movementCarriesWholeHexes` (`docs/adr/0008`). По букве статьи копится
 * только дробь; по умолчанию же переносится и целая часть, но не больше одной
 * Скорости — иначе Отряд Скорости 1 не смог бы войти ни в грязь, ни на
 * подъём ни за какое число Ходов.
 *
 * Скорость Численностью не режется — в отличие от Здоровья, Урона и Морали.
 * Меньший Отряд не медленнее; статья прямо об этом не говорит (вопрос 6 автору).
 *
 * Поселение режет кавалерии итог на 2 Гекса — статья говорит про Скорость, а
 * не про стоимость входа, поэтому штраф применяется здесь, а не в `stepCost`,
 * и не участвует в Инициативе: та считается по каталожной Скорости один раз
 * на Раунд.
 */
export const grantMovement = (board: Board, squad: Squad, carriesWholeHexes: boolean): number => {
  const speed = SQUAD_TYPES[squad.type].speed;
  const carried = carriesWholeHexes
    ? Math.min(squad.movement, speed)
    : squad.movement - Math.floor(squad.movement);
  const penalty = isCavalry(squad) ? (TERRAIN[terrainAt(board, squad.hex)].cavalryMovementPenalty ?? 0) : 0;
  return Math.max(0, carried + speed - penalty);
};

/** Тяжёлые Отряды раз в Ход поворачиваются, не тратя Запас хода. */
export const rotationIsFree = (squad: Squad): boolean =>
  SQUAD_TYPES[squad.type].weight === "heavy" && !squad.spent.freeRotation;
