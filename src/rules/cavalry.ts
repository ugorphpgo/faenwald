/**
 * Особенности кавалерии: Таранный удар и Маневренность.
 *
 * Разгон копится шагами вперёд подряд и живёт ровно один Ход — счётчик
 * обнуляется и началом Хода, и любым разворотом.
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import type { SquadTypeId } from "./catalog/squad-types.ts";
import { scaleToHeadcount } from "./scale.ts";
import type { Squad } from "./state.ts";

/** С какого разбега Таранный удар начинает бить ещё и по Морали. */
export const CHARGE_MORALE_THRESHOLD = 3;
/** Множитель морального урона у достаточно длинного разбега. */
export const CHARGE_MORALE_FACTOR = 1.25;

export const isCavalry = (squad: Squad): boolean => SQUAD_TYPES[squad.type].branch === "cavalry";

/** Разрешает перемещаться после атаки в том же Ходу. */
export const hasMobility = (squad: Squad): boolean => SQUAD_TYPES[squad.type].mobility ?? false;

/** Накопленный процент Таранного удара: шаги подряд × модификатор Типа. */
export const chargePercent = (squad: Squad): number =>
  squad.chargeSteps * (SQUAD_TYPES[squad.type].chargeModifier ?? 0);

/**
 * Множитель Урона от разбега: «1,x, где x — накопленный модификатор»
 * (48 → ×1,48; 120 → ×2,2). Без разгона — ровно единица.
 */
export const chargeMultiplier = (squad: Squad): number => 1 + chargePercent(squad) / 100;

/** Идёт ли Отряд в разбеге прямо сейчас. */
export const isCharging = (squad: Squad): boolean => chargePercent(squad) > 0;

/** Множитель морального урона: разбег от трёх Гексов добавляет ×1,25. */
export const chargeMoraleFactor = (squad: Squad): number =>
  squad.chargeSteps >= CHARGE_MORALE_THRESHOLD ? CHARGE_MORALE_FACTOR : 1;

/** Цена Спешивания и Седлания в Запасе хода. */
export const MOUNT_MOVEMENT_COST = 1;

/**
 * Пересчитывает Отряд в другой Тип, сохраняя долю Здоровья и Морали: «здоровье
 * конвертируется через проценты». Абсолютные значения при этом меняются вместе
 * с максимумами нового Типа.
 */
export const convertTo = (squad: Squad, becomes: SquadTypeId): Pick<Squad, "type" | "health" | "morale"> => {
  const from = SQUAD_TYPES[squad.type];
  const to = SQUAD_TYPES[becomes];
  const share = (current: number, oldPerHundred: number): number => {
    const oldMax = scaleToHeadcount(oldPerHundred, squad.headcount);
    return oldMax <= 0 ? 0 : current / oldMax;
  };

  return {
    type: becomes,
    health: scaleToHeadcount(to.health, squad.headcount) * share(squad.health, from.health),
    morale: scaleToHeadcount(to.morale, squad.headcount) * share(squad.morale, from.morale),
  };
};
