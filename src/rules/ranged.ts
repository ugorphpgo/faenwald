/**
 * Дальняя атака: геометрия трёх режимов стрельбы и их урон. Заменяет обычную
 * Атаку целиком для дальнобойных Отрядов — у них нет отдельного рукопашного
 * варианта, только Ближний бой со своими цифрами.
 */

import { SIDE_MORALE_FACTOR, maxHealthOf, strikeSide } from "./attack.ts";
import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import type { SquadType } from "./catalog/squad-types.ts";
import { TERRAIN } from "./catalog/terrain.ts";
import { resolveDamage } from "./damage.ts";
import type { DamageOutput } from "./damage.ts";
import { FACINGS, cone, neighbour, neighbours, sameHex } from "./hex.ts";
import { terrainAt } from "./movement.ts";
import { rangeBonus } from "./elevation.ts";
import type { Board, Facing, Hex, RangedMode, Squad } from "./state.ts";

/** Боезапас на Бой — восемь выстрелов, одинаково для всех дальнобойных Типов. */
export const AMMO_CAPACITY = 8;
/** Сколько Ходов подряд арбалетчик простаивает после выстрела ("раз в 2 хода"). */
export const RELOAD_COOLDOWN = 2;
/** Сколько дальнобойных союзников один Отряд может снабдить за весь Бой. */
export const RESUPPLY_LIMIT = 3;

const dedupeHexes = (hexes: readonly Hex[]): readonly Hex[] => {
  const seen = new Set<string>();
  const unique: Hex[] = [];
  for (const hex of hexes) {
    const key = `${hex.col},${hex.row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hex);
  }
  return unique;
};

/** Гексы конуса Навеса. Конный лучник бьёт во все шесть направлений сразу.
 *  Лучник, сам стоящий в лесу, не простреливает Навесом лесные Гексы конуса
 *  — крона мешает ему самому не меньше, чем цели. Зона провокации
 *  дальнобойного Отряда — тот же конус (`docs/adr/0002`), поэтому она
 *  сужается вместе с ним. */
export const arcReach = (board: Board, shooter: Squad): readonly Hex[] => {
  const type = SQUAD_TYPES[shooter.type];
  const depth = (type.arcDepth ?? 4) + rangeBonus(board, shooter);
  const raw = !type.omniDirectional
    ? cone(shooter.hex, shooter.facing, depth)
    : dedupeHexes(FACINGS.flatMap((facing) => cone(shooter.hex, facing, depth)));
  if (terrainAt(board, shooter.hex) !== "forest") return raw;
  return raw.filter((hex) => terrainAt(board, hex) !== "forest");
};

/** Один Гекс на линии Прямой наводки и Гексы, что стоят на пути к нему. */
export type DirectLine = { readonly target: Hex; readonly through: readonly Hex[] };

const lineAlong = (hex: Hex, facing: Facing, distance: number): DirectLine => {
  let current = hex;
  const through: Hex[] = [];
  for (let step = 1; step <= distance; step++) {
    current = neighbour(current, facing);
    if (step < distance) through.push(current);
  }
  return { target: current, through };
};

/** Лесной Гекс с хотя бы одним нелесным соседом — тот самый «крайний гекс
 *  леса», с которого статья разрешает стрелять за пределы леса свободно.
 *  Прочтение выведено: статья не определяет край буквально. */
const isForestEdge = (board: Board, hex: Hex): boolean =>
  neighbours(hex).some((neighbourHex) => terrainAt(board, neighbourHex) !== "forest");

/**
 * Возможные линии Прямой наводки. Дистанция Типа — ближняя граница («гекс через
 * гекс» у лучника, соседний у конного, на Гекс дальше у арбалетчика), а высота
 * отодвигает дальнюю: стрелок на холме простреливает всё от своей обычной
 * дистанции до неё же плюс два. Ближе обычной дистанции Прямая наводка не бьёт —
 * там начинается Ближний бой.
 *
 * Лучник в лесу — исключение по обеим границам. Ближе: он достаёт соседний
 * лесной Гекс Прямой наводкой (обычно это территория Ближнего боя, но здесь
 * режим и множитель ×2 остаются прежними — «без штрафа за ближний бой»).
 * Дальше: за пределы леса он стреляет обычным дальним диапазоном, только
 * если сам стоит на крайнем лесном Гексе — из глубины леса дальние линии не
 * строятся вовсе, а не просто окажутся перекрыты.
 *
 * У конного лучника линии идут во все шесть направлений сразу.
 */
export const directLines = (board: Board, shooter: Squad): readonly DirectLine[] => {
  const type = SQUAD_TYPES[shooter.type];
  const nearest = type.directDistance ?? 2;
  const furthest = nearest + rangeBonus(board, shooter);
  const facings = type.omniDirectional ? FACINGS : [shooter.facing];
  const shooterInForest = terrainAt(board, shooter.hex) === "forest";
  const canFireBeyondForest = !shooterInForest || isForestEdge(board, shooter.hex);

  const lines: DirectLine[] = [];
  for (const facing of facings) {
    if (shooterInForest && nearest > 1) {
      const adjacent = lineAlong(shooter.hex, facing, 1);
      if (terrainAt(board, adjacent.target) === "forest") lines.push(adjacent);
    }
    if (!canFireBeyondForest) continue;
    for (let distance = nearest; distance <= furthest; distance++) {
      lines.push(lineAlong(shooter.hex, facing, distance));
    }
  }
  return lines;
};

/** Лес на линии Прямой наводки закрывает её целиком, независимо от того, кто
 *  на ней стоит: крона не пропускает выстрел дальше первой стены зелени. */
export const forestBlocksLine = (board: Board, line: DirectLine): boolean =>
  line.through.some((hex) => terrainAt(board, hex) === "forest");

/** Ближний бой бьёт в любой соседний Гекс — единственный режим, не привязанный
 *  к Фронту ни у одного дальнобойного Типа. */
export const meleeShotReach = (shooter: Squad): readonly Hex[] => neighbours(shooter.hex);

/** Отряд, перекрывающий линию Прямой наводки — если он не ниже стрелка. */
export const blockingSquad = (
  board: Board,
  squads: readonly Squad[],
  shooter: Squad,
  line: DirectLine,
): Squad | undefined => {
  const shooterElevation = TERRAIN[terrainAt(board, shooter.hex)].elevation;
  return squads.find(
    (squad) =>
      line.through.some((hex) => sameHex(hex, squad.hex)) &&
      TERRAIN[terrainAt(board, squad.hex)].elevation >= shooterElevation,
  );
};

/** Множитель режима: Навес ×1, Прямая наводка ×2, Ближний бой — своё число
 *  (обычно 0,5; у арбалетчика 0,75). */
export const modeFactor = (mode: RangedMode, shooterType: SquadType): number => {
  switch (mode) {
    case "arcShot":
      return 1;
    case "directShot":
      return 2;
    case "meleeShot":
      return shooterType.meleeShotFactor ?? 0.5;
  }
};

export type RangedStrike = {
  readonly attacker: Squad;
  readonly defender: Squad;
  readonly mode: RangedMode;
  /** Множитель Местности под целью — заросли и лес режут дальний бой. */
  readonly terrainFactor: number;
};

/** Разрешает Удар одного из трёх режимов Дальней атаки. */
export const resolveRangedStrike = (strike: RangedStrike): DamageOutput => {
  const shooterType = SQUAD_TYPES[strike.attacker.type];
  const targetType = SQUAD_TYPES[strike.defender.type];
  const resistance = targetType.incomingFrom?.ranged;

  const modifiers = [
    modeFactor(strike.mode, shooterType),
    strike.terrainFactor,
    ...(resistance !== undefined && !shooterType.ignoresRangedResistance ? [resistance] : []),
  ];

  return resolveDamage({
    naturalDamage: shooterType.damage,
    headcount: strike.attacker.headcount,
    health: strike.attacker.health,
    maxHealth: maxHealthOf(strike.attacker),
    modifiers,
    moraleModifiers: [SIDE_MORALE_FACTOR[strikeSide(strike.attacker, strike.defender)]],
    moraleExemptFromCap: false,
  });
};

/**
 * Ближний бой: самоурон стрелка, ×1,5 от его же естественного Урона, и только
 * по Морали. Число не дано статьёй буквально ("получает ×1,5 морального
 * урона") — читаем это как множитель к собственному, немодифицированному Урону
 * стрелка, а не к уже урезанному режимом исходящему удару.
 */
export const meleeShotSelfMorale = (shooter: Squad): number => {
  const type = SQUAD_TYPES[shooter.type];
  const dealt = resolveDamage({
    naturalDamage: type.damage,
    headcount: shooter.headcount,
    health: shooter.health,
    maxHealth: maxHealthOf(shooter),
    modifiers: [],
    moraleModifiers: [1.5],
    moraleExemptFromCap: false,
  });
  return dealt.morale;
};
