import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import type { BattleState, Intent } from "./index.ts";

const board = { width: 8, height: 8 };

const twoSquads = (headcount?: number) =>
  start(
    {
      board,
      squads: [
        { id: "blue", side: "blue" as const, type: "heavySpearman" as const, hex: { col: 1, row: 1 }, facing: 0 as const, ...(headcount === undefined ? {} : { headcount }) },
        { id: "red", side: "red" as const, type: "heavySpearman" as const, hex: { col: 5, row: 5 }, facing: 3 as const },
      ],
    },
    {},
    7,
  );

const run = (state: BattleState, intents: readonly Intent[]): BattleState => {
  let current = state;
  for (const intent of intents) {
    const applied = apply(current, intent);
    assert.ok(applied.ok);
    if (!applied.ok) throw new Error("unreachable");
    current = applied.state;
  }
  return current;
};

describe("Состояние Боя", () => {
  test("характеристики Типа даны на сотню и режутся долей Численности", () => {
    const full = squadById(twoSquads(), "blue");
    const tenth = squadById(twoSquads(10), "blue");
    const type = SQUAD_TYPES.heavySpearman;

    assert.equal(full?.health, type.health);
    assert.equal(full?.morale, type.morale);
    assert.equal(tenth?.health, type.health * 0.1);
    assert.equal(tenth?.morale, type.morale * 0.1);
  });

  test("состояние переживает сериализацию без потерь", () => {
    const state = run(twoSquads(), [{ kind: "endTurn" }]);
    const revived = JSON.parse(JSON.stringify(state)) as BattleState;

    assert.deepEqual(revived, state);
    assert.equal(revived.rng.seed, state.rng.seed);
  });

  test("одна последовательность намерений при одном зерне даёт одно состояние", () => {
    const intents: Intent[] = [{ kind: "endTurn" }, { kind: "endTurn" }, { kind: "endTurn" }];

    assert.deepEqual(run(twoSquads(), intents), run(twoSquads(), intents));
  });

  test("политики попадают в состояние и переопределяются при старте", () => {
    const byDefault = twoSquads();
    assert.equal(byDefault.policies.counterattackSpendsDefendersAttack, false);

    const overridden = start(
      { board, squads: [{ id: "solo", side: "blue", type: "archer", hex: { col: 1, row: 1 }, facing: 0 }] },
      { counterattackSpendsDefendersAttack: true },
      7,
    );
    assert.equal(overridden.policies.counterattackSpendsDefendersAttack, true);
  });

  test("применение намерения не мутирует исходное состояние", () => {
    const before = twoSquads();
    const snapshot = JSON.parse(JSON.stringify(before)) as BattleState;
    run(before, [{ kind: "endTurn" }]);

    assert.deepEqual(before, snapshot);
  });

  test("Время года по умолчанию — лето", () => {
    assert.equal(twoSquads().season, "summer");
  });

  test("Время года задаётся в Setup и переживает сериализацию", () => {
    const state = start(
      { board, squads: [{ id: "solo", side: "blue", type: "archer", hex: { col: 1, row: 1 }, facing: 0 }], season: "winter" },
      {},
      7,
    );
    assert.equal(state.season, "winter");

    const revived = JSON.parse(JSON.stringify(state)) as BattleState;
    assert.equal(revived.season, "winter");
  });
});
