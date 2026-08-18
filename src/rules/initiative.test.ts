import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents } from "./index.ts";
import type { BattleState } from "./index.ts";

const board = { width: 10, height: 10 };

const activeSquad = (state: BattleState): string => {
  assert.equal(state.phase.kind, "turn");
  if (state.phase.kind !== "turn") throw new Error("unreachable");
  return state.phase.squad;
};

const endTurn = (state: BattleState): BattleState => {
  const applied = apply(state, { kind: "endTurn" });
  assert.ok(applied.ok, `endTurn rejected: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

const orderOfRound = (state: BattleState, count: number): string[] => {
  const seen: string[] = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    seen.push(activeSquad(current));
    current = endTurn(current);
  }
  return seen;
};

describe("Инициатива", () => {
  test("пример статьи: синие лучники, красные лучники, синие копейщики, красные копейщики", () => {
    // Лучник и лёгкий копейщик имеют равную Скорость 3, поэтому очередь решает
    // Род войск, а при равном Роде — цвет.
    const state = start(
      {
        board,
        squads: [
          { id: "red-spear", side: "red", type: "lightSpearman", hex: { col: 1, row: 5 }, facing: 0 },
          { id: "blue-spear", side: "blue", type: "lightSpearman", hex: { col: 1, row: 1 }, facing: 0 },
          { id: "red-archer", side: "red", type: "archer", hex: { col: 3, row: 5 }, facing: 0 },
          { id: "blue-archer", side: "blue", type: "archer", hex: { col: 3, row: 1 }, facing: 0 },
        ],
      },
      {},
      1,
    );

    assert.deepEqual(orderOfRound(state, 4), [
      "blue-archer",
      "red-archer",
      "blue-spear",
      "red-spear",
    ]);
  });

  test("быстрейший Отряд ходит первым независимо от Рода войск", () => {
    // Тяжёлый копейщик Скорости 1 против лёгкой кавалерии Скорости 5.
    const state = start(
      {
        board,
        squads: [
          { id: "spear", side: "blue", type: "heavySpearman", hex: { col: 1, row: 1 }, facing: 0 },
          { id: "horse", side: "red", type: "lightCavalry", hex: { col: 5, row: 5 }, facing: 0 },
        ],
      },
      {},
      1,
    );

    assert.deepEqual(orderOfRound(state, 2), ["horse", "spear"]);
  });

  test("при равной Скорости ударная пехота ходит раньше копейщиков", () => {
    const state = start(
      {
        board,
        squads: [
          { id: "spear", side: "blue", type: "lightSpearman", hex: { col: 1, row: 1 }, facing: 0 },
          { id: "shock", side: "blue", type: "lightInfantry", hex: { col: 2, row: 1 }, facing: 0 },
        ],
      },
      {},
      1,
    );

    assert.deepEqual(orderOfRound(state, 2), ["shock", "spear"]);
  });

  test("Раунд закрывается, когда отходили все Отряды, и очередь повторяется", () => {
    const state = start(
      {
        board,
        squads: [
          { id: "blue-archer", side: "blue", type: "archer", hex: { col: 1, row: 1 }, facing: 0 },
          { id: "red-archer", side: "red", type: "archer", hex: { col: 5, row: 5 }, facing: 0 },
        ],
      },
      {},
      1,
    );

    assert.equal(state.round, 1);
    const afterRound = endTurn(endTurn(state));
    assert.equal(afterRound.round, 2);
    assert.deepEqual(orderOfRound(afterRound, 2), ["blue-archer", "red-archer"]);
  });

  test("завершение Хода законно всегда, пока идёт Ход", () => {
    const state = start(
      {
        board,
        squads: [{ id: "solo", side: "blue", type: "archer", hex: { col: 1, row: 1 }, facing: 0 }],
      },
      {},
      1,
    );

    assert.ok(legalIntents(state).some((intent) => intent.kind === "endTurn"));
  });
});
