import { chargeMoraleFactor, chargeMultiplier, isCharging } from "./cavalry.ts";
import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { resolveDamage } from "./damage.ts";
import type { DamageOutput } from "./damage.ts";
import { sameHex, sides, sideOf } from "./hex.ts";
import { scaleToHeadcount } from "./scale.ts";
import type { Hex, Squad } from "./state.ts";

/** Множители морального урона по стороне, с которой пришёл удар. */
export const SIDE_MORALE_FACTOR = { front: 1, flank: 1.25, rear: 1.5 } as const;

export const isEnemy = (a: Squad, b: Squad): boolean => a.side !== b.side;

/** Лежит ли Гекс на одном из двух Гексов Фронта Отряда. Общая проверка для шага и удара. */
export const facesHex = (squad: Squad, hex: Hex): boolean =>
  sides(squad.hex, squad.facing).front.some((candidate) => sameHex(candidate, hex));

/** Достаёт ли Отряд цель Атакой: цель на одном из двух Гексов его Фронта. */
export const inAttackReach = (attacker: Squad, defender: Squad): boolean =>
  facesHex(attacker, defender.hex);

/** Сторона защитника, с которой пришёл удар. */
export const strikeSide = (attacker: Squad, defender: Squad): "front" | "flank" | "rear" =>
  sideOf(defender.hex, defender.facing, attacker.hex) ?? "front";

export const maxHealthOf = (squad: Squad): number =>
  scaleToHeadcount(SQUAD_TYPES[squad.type].health, squad.headcount);

export const maxMoraleOf = (squad: Squad): number =>
  scaleToHeadcount(SQUAD_TYPES[squad.type].morale, squad.headcount);

export type Strike = {
  readonly attacker: Squad;
  readonly defender: Squad;
  /** Множители, общие для физического и морального урона (Местность, строй, Уровень). */
  readonly modifiers?: readonly number[];
  /** Множители только для физического урона (Тыл копейщика). */
  readonly healthModifiers?: readonly number[];
  /** Подменяет вычисленную сторону — Прорыв читает удар ударной пехоты в Тыл
   *  как удар по Флангу. */
  readonly sideOverride?: "front" | "flank" | "rear";
};

/**
 * Удар: сторона защитника усиливает только моральный урон.
 *
 * Разбег атакующего входит сюда сам: множитель Таранного удара, собственное
 * сопротивление цели разбегу и добавка к Морали за длинный разгон читаются
 * прямо из состояния Отрядов, а не передаются вызывающим — иначе каждое место,
 * наносящее Удар, обязано было бы про них помнить.
 */
export const resolveStrike = (strike: Strike): DamageOutput => {
  const type = SQUAD_TYPES[strike.attacker.type];
  const defenderType = SQUAD_TYPES[strike.defender.type];
  const versus = type.outgoingVsBranch?.[defenderType.branch];
  const side = strike.sideOverride ?? strikeSide(strike.attacker, strike.defender);

  const charging = isCharging(strike.attacker);
  const chargeResistance = charging ? defenderType.incomingFrom?.charge : undefined;

  return resolveDamage({
    naturalDamage: type.damage,
    headcount: strike.attacker.headcount,
    health: strike.attacker.health,
    maxHealth: maxHealthOf(strike.attacker),
    modifiers: [
      ...(strike.modifiers ?? []),
      ...(versus === undefined ? [] : [versus]),
      chargeMultiplier(strike.attacker),
      ...(chargeResistance === undefined ? [] : [chargeResistance]),
    ],
    healthModifiers: strike.healthModifiers ?? [],
    moraleModifiers: [SIDE_MORALE_FACTOR[side], chargeMoraleFactor(strike.attacker)],
    // «Исключение: моральный урон, наносимый кавалерией. Он никак не режется.»
    moraleExemptFromCap: type.branch === "cavalry",
  });
};
