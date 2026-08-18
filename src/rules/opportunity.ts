/**
 * Взведение права Оппортуна. Протокол прерывания (Фаза, откладывание и
 * исполнение намерения провокатора) живёт в `index.ts` — он завязан на
 * `Board_`/`commit`/`settle`, которые ядро не выносит наружу.
 */

import { facesHex } from "./attack.ts";
import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { arcReach } from "./ranged.ts";
import type { ArmedThreat, Board, Hex, Squad, SquadId } from "./state.ts";

/**
 * Зона провокации: у ближнего боя — обычная досягаемость Атаки (два Гекса
 * Фронта), у дальнобойных — весь конус Навеса, потому что статья прямо
 * приводит лучников примером Оппортуна (`docs/adr/0002`).
 */
export const withinThreatZone = (board: Board, holder: Squad, hex: Hex): boolean => {
  const type = SQUAD_TYPES[holder.type];
  if (type.branch === "ranged") return arcReach(board, holder).some((candidate) => candidate.col === hex.col && candidate.row === hex.row);
  return facesHex(holder, hex);
};

/** Держатели, которые прямо сейчас могут ударить провокатора Оппортуном. */
export const armedAgainst = (armedThreats: readonly ArmedThreat[], provokerId: SquadId): readonly SquadId[] =>
  armedThreats.filter((threat) => threat.against === provokerId).map((threat) => threat.holder);

/**
 * Взводит право Оппортуна каждому врагу, чья Зона провокации теперь накрывает
 * `mover`. Враг не участвует, если он в Бегстве, уже потратил свою Атаку, или
 * — для дальнобойных — если у него кончился Боезапас, идёт перезарядка, или
 * сам `mover` (лёгкая кавалерия) неуязвим для Оппортуна дальнего боя.
 */
export const armThreatsFor = (
  board: Board,
  squads: readonly Squad[],
  armedThreats: readonly ArmedThreat[],
  mover: Squad,
): { readonly armedThreats: readonly ArmedThreat[]; readonly armed: readonly SquadId[] } => {
  const already = new Set(armedAgainst(armedThreats, mover.id));
  const moverImmuneToRanged = SQUAD_TYPES[mover.type].immuneToRangedOpportunity ?? false;
  const armed: SquadId[] = [];

  for (const enemy of squads) {
    if (enemy.side === mover.side || enemy.id === mover.id) continue;
    if (enemy.routing || enemy.spent.attacked) continue;
    if (already.has(enemy.id)) continue;

    const enemyType = SQUAD_TYPES[enemy.type];
    if (enemyType.branch === "ranged") {
      if (moverImmuneToRanged) continue;
      if (enemy.ammo <= 0 || enemy.rangedCooldown > 0) continue;
    }

    if (!withinThreatZone(board, enemy, mover.hex)) continue;
    armed.push(enemy.id);
  }

  return {
    armedThreats: [...armedThreats, ...armed.map((holder) => ({ holder, against: mover.id }))],
    armed,
  };
};
