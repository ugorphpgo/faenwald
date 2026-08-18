import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import { sides } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });
const key = (hex: Hex): string => `${hex.col},${hex.row}`;

const ok = (state: BattleState, intent: Intent): BattleState => {
  const applied = apply(state, intent);
  assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

/** Ставит Отряд перед единственным ледяным Гексом карты, зимой, на заданном
 *  зерне. Возвращает состояние и сам ледяной Гекс. */
const beforeIce = (
  type: SquadSetup["type"],
  seed: number,
  headcount?: number,
): { readonly state: BattleState; readonly ice: Hex } => {
  const home = at(5, 5);
  const [ice] = sides(home, 0).front;
  if (ice === undefined) throw new Error("unreachable");
  const state = start(
    {
      board: { width: 12, height: 12, terrain: { [key(ice)]: "water" } },
      squads: [{ id: "mover", side: "blue", type, hex: home, facing: 0, ...(headcount === undefined ? {} : { headcount }) }],
      season: "winter",
    },
    {},
    seed,
  );
  return { state, ice };
};

describe("Провал льда", () => {
  // Зерно 7 даёт первым броском d100 значение 2 — проваливается любой Тип,
  // минимальный шанс в статье 5%. Зерно 1 даёт 63 — не проваливается даже
  // тяжёлая кавалерия с максимальным шансом 25%.

  test("провал отнимает половину максимума Здоровья", () => {
    const { state, ice } = beforeIce("lightSpearman", 7);
    const before = squadById(state, "mover")!;

    const after = ok(state, { kind: "step", to: ice });
    const moved = squadById(after, "mover")!;

    assert.equal(moved.health, before.health - Math.round(SQUAD_TYPES.lightSpearman.health * 0.5));
  });

  test("провал возвращает Отряд на прежний Гекс, Направление сохраняется", () => {
    const { state, ice } = beforeIce("lightSpearman", 7);
    const before = squadById(state, "mover")!;

    const after = ok(state, { kind: "step", to: ice });
    const moved = squadById(after, "mover")!;

    assert.deepEqual(moved.hex, before.hex);
    assert.equal(moved.facing, before.facing);
  });

  test("Запас хода тратится даже при провале", () => {
    const { state, ice } = beforeIce("lightSpearman", 7);
    const before = squadById(state, "mover")!;

    const after = ok(state, { kind: "step", to: ice });
    const moved = squadById(after, "mover")!;

    assert.ok(moved.movement < before.movement);
  });

  test("провал может уничтожить Отряд", () => {
    const { state, ice } = beforeIce("lightSpearman", 7);
    const damage = Math.round(SQUAD_TYPES.lightSpearman.health * 0.5);
    const fragile: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "mover" ? { ...squad, health: damage - 1 } : squad)),
    };

    const after = ok(fragile, { kind: "step", to: ice });

    assert.equal(squadById(after, "mover"), undefined);
    assert.ok(after.log.some((event) => event.kind === "squadDestroyed" && event.squad === "mover"));
  });

  test("успешный вход на лёд ничего не стоит сверх обычной стоимости шага", () => {
    const { state, ice } = beforeIce("heavyCavalry", 1);
    const before = squadById(state, "mover")!;

    const after = ok(state, { kind: "step", to: ice });
    const moved = squadById(after, "mover")!;

    assert.deepEqual(moved.hex, ice);
    assert.equal(moved.health, before.health);
    assert.equal(moved.movement, before.movement - 1); // равнинная стоимость входа
  });

  test("летом проверка не выполняется вовсе — зерно не тратится", () => {
    const home = at(5, 5);
    const target = sides(home, 0).front[0]!;
    const state = start(
      { board: { width: 12, height: 12 }, squads: [{ id: "mover", side: "blue", type: "lightSpearman", hex: home, facing: 0 }] },
      {},
      7,
    );

    const after = ok(state, { kind: "step", to: target });
    assert.equal(after.rng.seed, state.rng.seed);
  });
});
