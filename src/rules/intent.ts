import type { Facing, Hex, RangedMode, SquadId } from "./state.ts";

/** Намерения игрока. `apply` — единственный вход, поэтому решения внутри любой
 *  Фазы выражаются такими же намерениями, как обычный шаг. */
export type Intent =
  | { readonly kind: "step"; readonly to: Hex }
  | { readonly kind: "rotate"; readonly facing: Facing }
  | { readonly kind: "surge" }
  | { readonly kind: "attack"; readonly target: SquadId }
  /** Дальняя атака дальнобойного Отряда — заменяет обычную Атаку целиком. */
  | { readonly kind: "rangedAttack"; readonly target: SquadId; readonly mode: RangedMode }
  /** Снабжает союзный дальнобойный Отряд Боезапасом. */
  | { readonly kind: "resupply"; readonly target: SquadId }
  | { readonly kind: "concede" }
  | { readonly kind: "endTurn" }
  /** Ответ текущего держателя в Фазе Оппортуна: ударить или отказаться. */
  | { readonly kind: "opportunity"; readonly strike: boolean }
  /** Ответ в Фазе Прорыва: отодвинуть цель или оставить как есть. */
  | { readonly kind: "breakthrough"; readonly push: boolean }
  /** Спешивание: кавалерия становится пехотой, оставляя коней на Гексе. */
  | { readonly kind: "dismount" }
  /** Седлание: пехота поднимает оставленных на её Гексе коней. */
  | { readonly kind: "mount" };
