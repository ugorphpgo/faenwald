import { SQUAD_TYPES, branchInitiativeRank } from "./catalog/squad-types.ts";
import type { Squad, SquadId } from "./state.ts";

const sideRank = (side: Squad["side"]): number => (side === "blue" ? 0 : 1);

/**
 * Инициатива: сначала по Скорости — быстрейшие первыми; при равной Скорости по
 * Роду войск (кавалерия, дальнобойные, ударная пехота, копейщики); при равном Роде
 * синие раньше красных. Порядок в расстановке — последний разрешитель ничьих,
 * чтобы очередь оставалась детерминированной.
 */
export const initiativeOrder = (squads: readonly Squad[]): readonly SquadId[] =>
  squads
    .map((squad, index) => ({ squad, index }))
    .sort((a, b) => {
      const typeA = SQUAD_TYPES[a.squad.type];
      const typeB = SQUAD_TYPES[b.squad.type];

      if (typeA.speed !== typeB.speed) return typeB.speed - typeA.speed;

      const branchA = branchInitiativeRank(typeA.branch);
      const branchB = branchInitiativeRank(typeB.branch);
      if (branchA !== branchB) return branchA - branchB;

      const sideA = sideRank(a.squad.side);
      const sideB = sideRank(b.squad.side);
      if (sideA !== sideB) return sideA - sideB;

      return a.index - b.index;
    })
    .map(({ squad }) => squad.id);
