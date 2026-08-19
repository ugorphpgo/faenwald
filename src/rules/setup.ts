/**
 * Законность расстановки. Тот же принцип, что у `legalIntents`: судит ядро, а
 * экран только спрашивает и рисует — иначе правила расползутся по компонентам
 * ровно так, как этого избегает `docs/adr/0001`.
 *
 * Зоны расстановки статья не описывает; прочтение выведено (`docs/adr/0007`).
 * Фазы расстановки в `Phase` нет намеренно: выкладка одновременная и открытая,
 * точек передачи Хода в ней не возникает.
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { sameHex, withinBoard } from "./hex.ts";
import { isPassable } from "./movement.ts";
import { DEFAULT_SEASON } from "./state.ts";
import type { Hex, Setup, Side, SquadId, SquadSetup } from "./state.ts";

export type SetupViolationKind =
  /** Два и более Отряда на одном Гексе. */
  | "hexOccupied"
  /** Гекс лежит за границами Карты. */
  | "offBoard"
  /** Гекс непроходим — гора, или вода не зимой. */
  | "impassable"
  /** Отряд стоит вне Зоны расстановки своей стороны (в том числе в чужой). */
  | "outsideDeployment"
  /** Больше одного Правителя на сторону. */
  | "duplicateRuler"
  /** У стороны нет ни одного Отряда. */
  | "emptySide"
  /** Тип Отряда отсутствует в каталоге. */
  | "unknownType"
  /** Два Отряда с одним идентификатором. */
  | "duplicateId";

/**
 * Одно нарушение. Форма «вид плюс подробность» повторяет `Rejection`, но тип
 * свой: у расстановки нет ни одного общего вида с отказами `apply`, и
 * склеивать их значило бы заставить интерфейс разбирать чужие варианты.
 *
 * `squads` перечисляет всех участников нарушения — двух Отрядов на одном
 * Гексе, обоих Правителей, — чтобы экран подсветил их разом. У нарушений про
 * сторону целиком список пуст, но `side` заполнен.
 */
export type SetupViolation = {
  readonly kind: SetupViolationKind;
  readonly squads: readonly SquadId[];
  readonly side?: Side;
  readonly hex?: Hex;
  readonly detail?: string;
};

const SIDES: readonly Side[] = ["blue", "red"];

const key = (hex: Hex): string => `${hex.col},${hex.row}`;

const knownType = (squad: SquadSetup): boolean => Object.hasOwn(SQUAD_TYPES, squad.type);

/**
 * Все нарушения расстановки разом, а не первое: экран обязан показать игроку
 * весь список, иначе он чинит расстановку в семь заходов. Пустой массив —
 * расстановка законна.
 */
export const validateSetup = (setup: Setup): readonly SetupViolation[] => {
  const violations: SetupViolation[] = [];
  const season = setup.season ?? DEFAULT_SEASON;

  // Идентификаторы: проверяются первыми, потому что всё остальное ссылается на
  // Отряды по id, и дубль сделал бы прочие сообщения неоднозначными.
  const byId = new Map<SquadId, SquadSetup[]>();
  for (const squad of setup.squads) {
    byId.set(squad.id, [...(byId.get(squad.id) ?? []), squad]);
  }
  for (const [id, group] of byId) {
    if (group.length > 1) {
      violations.push({ kind: "duplicateId", squads: [id], detail: `Отрядов с этим идентификатором: ${group.length}` });
    }
  }

  for (const squad of setup.squads) {
    if (!knownType(squad)) {
      violations.push({ kind: "unknownType", squads: [squad.id], detail: squad.type });
      // Дальше по этому Отряду судить нечем: каталог не отвечает на вопросы о нём.
      continue;
    }

    if (!withinBoard(squad.hex, setup.board)) {
      violations.push({ kind: "offBoard", squads: [squad.id], hex: squad.hex });
      // Проходимость и зоны за границей Карты не определены — не выдумываем их.
      continue;
    }

    if (!isPassable(setup.board, squad.hex, season)) {
      violations.push({ kind: "impassable", squads: [squad.id], hex: squad.hex });
    }

    // Карта без объявленных Зон расстановки не ограничивает выкладку ничем.
    const zone = setup.board.deployment?.[squad.side];
    if (zone !== undefined && !zone.some((hex) => sameHex(hex, squad.hex))) {
      violations.push({ kind: "outsideDeployment", squads: [squad.id], side: squad.side, hex: squad.hex });
    }
  }

  // Занятость Гекса: одно нарушение на Гекс, со всеми претендентами сразу.
  const byHex = new Map<string, SquadSetup[]>();
  for (const squad of setup.squads) {
    byHex.set(key(squad.hex), [...(byHex.get(key(squad.hex)) ?? []), squad]);
  }
  for (const group of byHex.values()) {
    const first = group[0];
    if (group.length > 1 && first !== undefined) {
      violations.push({ kind: "hexOccupied", squads: group.map((squad) => squad.id), hex: first.hex });
    }
  }

  for (const side of SIDES) {
    const ofSide = setup.squads.filter((squad) => squad.side === side);
    if (ofSide.length === 0) violations.push({ kind: "emptySide", squads: [], side });

    const rulers = ofSide.filter((squad) => squad.ruler === true);
    if (rulers.length > 1) {
      violations.push({ kind: "duplicateRuler", squads: rulers.map((squad) => squad.id), side });
    }
  }

  return violations;
};
