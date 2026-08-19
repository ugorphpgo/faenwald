import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById } from "../rules/index.ts";
import type { BattleState, Board, Hex, Side, SquadSetup } from "../rules/index.ts";
import { HILL_AND_THICKET, MAPS, OPEN_FIELD } from "./fixtures.ts";

const inBoard = (hex: Hex, board: Board): boolean =>
  hex.col >= 0 && hex.row >= 0 && hex.col < board.width && hex.row < board.height;

const SIDES: readonly Side[] = ["blue", "red"];

describe("Фикстуры Карт", () => {
  for (const [name, board] of Object.entries(MAPS)) {
    describe(name, () => {
      test("объявляет Зону расстановки обеим сторонам", () => {
        assert.ok(board.deployment !== undefined);
        for (const side of SIDES) assert.ok((board.deployment?.[side] ?? []).length > 0);
      });

      test("объявляет край Обоза обеим сторонам, и края разные", () => {
        assert.ok(board.baggage !== undefined);
        assert.notEqual(board.baggage?.blue, board.baggage?.red);
      });

      test("Зоны расстановки лежат внутри Карты и не пересекаются", () => {
        const blue = board.deployment?.blue ?? [];
        const red = board.deployment?.red ?? [];
        for (const hex of [...blue, ...red]) assert.ok(inBoard(hex, board), `Гекс вне Карты: ${hex.col},${hex.row}`);

        const blueKeys = new Set(blue.map((hex) => `${hex.col},${hex.row}`));
        const overlap = red.filter((hex) => blueKeys.has(`${hex.col},${hex.row}`));
        assert.deepEqual(overlap, []);
      });

      test("Местность объявлена только для Гексов внутри Карты", () => {
        for (const key of Object.keys(board.terrain ?? {})) {
          const [col, row] = key.split(",").map(Number);
          assert.ok(inBoard({ col: col!, row: row! }, board), `Местность вне Карты: ${key}`);
        }
      });
    });
  }

  test("Бой стартует на фикстуре и её поля переживают сериализацию", () => {
    const squads: readonly SquadSetup[] = [
      { id: "blue", side: "blue", type: "mediumInfantry", hex: { col: 5, row: 1 }, facing: 3 },
      { id: "red", side: "red", type: "mediumInfantry", hex: { col: 5, row: 10 }, facing: 0 },
    ];
    const state = start({ board: HILL_AND_THICKET, squads }, {}, 1);
    const revived = JSON.parse(JSON.stringify(state)) as BattleState;

    assert.deepEqual(revived.board.deployment, HILL_AND_THICKET.deployment);
    assert.deepEqual(revived.board.baggage, HILL_AND_THICKET.baggage);
    assert.deepEqual(revived, state);
  });
});

describe("Новые поля Карты не меняют механику", () => {
  const squads: readonly SquadSetup[] = [
    { id: "blue", side: "blue", type: "mediumInfantry", hex: { col: 5, row: 5 }, facing: 3 },
    { id: "red", side: "red", type: "mediumInfantry", hex: { col: 8, row: 8 }, facing: 0 },
  ];
  const bare: Board = { width: 12, height: 12 };
  const decorated: Board = {
    ...bare,
    deployment: { blue: [{ col: 5, row: 5 }], red: [{ col: 8, row: 8 }] },
    baggage: { blue: "north", red: "south" },
  };

  test("Карта без новых полей остаётся валидной", () => {
    const state = start({ board: bare, squads }, {}, 1);
    assert.equal(state.board.deployment, undefined);
    assert.equal(state.board.baggage, undefined);
    assert.equal(state.phase.kind, "turn");
  });

  test("одна и та же партия идёт одинаково с полями и без", () => {
    const play = (board: Board): BattleState => {
      let current = start({ board, squads }, {}, 1);
      for (const intent of [{ kind: "endTurn" }, { kind: "endTurn" }, { kind: "endTurn" }] as const) {
        const applied = apply(current, intent);
        assert.ok(applied.ok);
        if (!applied.ok) throw new Error("unreachable");
        current = applied.state;
      }
      return current;
    };

    const withoutFields = play(bare);
    const withFields = play(decorated);

    // Сравниваем всё, кроме самой доски: поведение обязано совпасть до Гекса.
    assert.deepEqual({ ...withFields, board: null }, { ...withoutFields, board: null });
    assert.deepEqual(squadById(withFields, "blue")?.hex, squadById(withoutFields, "blue")?.hex);
  });
});
