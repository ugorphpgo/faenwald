import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import { neighbour } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";
import type { TerrainId } from "./catalog/terrain.ts";

const at = (col: number, row: number): Hex => ({ col, row });
const key = (hex: Hex): string => `${hex.col},${hex.row}`;

const battle = (squads: readonly SquadSetup[], terrain: Readonly<Record<string, TerrainId>>): BattleState =>
  start({ board: { width: 16, height: 16, terrain }, squads }, {}, 1);

const ok = (state: BattleState, intent: Intent): BattleState => {
  const applied = apply(state, intent);
  assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

const rejected = (state: BattleState, intent: Intent): string => {
  const applied = apply(state, intent);
  assert.equal(applied.ok, false);
  if (applied.ok) throw new Error("unreachable");
  return applied.reason.kind;
};

const untilActive = (state: BattleState, squad: string): BattleState => {
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    if (current.phase.kind === "turn" && current.phase.squad === squad) return current;
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error(`Отряд ${squad} так и не получил Ход`);
};

const SHOOTER = at(7, 7);

/** Стрелок в (7,7) лицом на восток (facing 0), союзный якорь в углу и цель
 *  на заданном Гексе. mediumInfantry у цели — без собственных модификаторов
 *  входящего дальнего урона. */
const withTarget = (targetHex: Hex, terrain: Readonly<Record<string, TerrainId>>): BattleState =>
  battle(
    [
      { id: "shooter", side: "blue", type: "archer", hex: SHOOTER, facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      { id: "target", side: "red", type: "mediumInfantry", hex: targetHex, facing: 3 },
    ],
    terrain,
  );

/** Лес во всех шести соседях Гекса плюс сам Гекс — так стрелок оказывается в
 *  глубине леса, а не на его краю. */
const forestAround = (hex: Hex): Record<string, TerrainId> => {
  const terrain: Record<string, TerrainId> = { [key(hex)]: "forest" };
  for (let facing = 0; facing < 6; facing++) {
    terrain[key(neighbour(hex, facing as 0 | 1 | 2 | 3 | 4 | 5))] = "forest";
  }
  return terrain;
};

describe("Лес: Навес", () => {
  test("лучник в лесу не бьёт Навесом по лесным Гексам", () => {
    const target = at(9, 7);
    const state = withTarget(target, { [key(SHOOTER)]: "forest", [key(target)]: "forest" });

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" }),
      "outOfRange",
    );
  });

  test("лучник в лесу бьёт Навесом по нелесным Гексам конуса", () => {
    const target = at(9, 7);
    const state = withTarget(target, { [key(SHOOTER)]: "forest" });

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage);
  });

  test("лучник вне леса бьёт Навесом по лесному Гексу — запрет только для лесного стрелка", () => {
    const target = at(9, 7);
    const state = withTarget(target, { [key(target)]: "forest" });

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - Math.round(SQUAD_TYPES.archer.damage * 0.5),
    );
  });
});

describe("Лес: Прямая наводка", () => {
  test("лес на линии запрещает Прямую наводку", () => {
    const between = neighbour(SHOOTER, 0);
    const target = at(9, 7);
    const state = withTarget(target, { [key(between)]: "forest" });

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "lineBlocked",
    );
  });

  test("лес на линии не мешает Навесу — он летит поверх", () => {
    const between = neighbour(SHOOTER, 0);
    const target = at(9, 7);
    const state = withTarget(target, { [key(between)]: "forest" });

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage);
  });

  test("лучник в лесу достаёт Прямой наводкой соседний лесной Гекс", () => {
    const adjacent = neighbour(SHOOTER, 0);
    const state = withTarget(adjacent, { [key(SHOOTER)]: "forest", [key(adjacent)]: "forest" });

    // Обычно соседний Гекс — территория Ближнего боя, лучник туда Прямой
    // наводкой не бьёт (см. «не бьёт мимо своей дальности» в ranged.test.ts).
    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      // ×2 за режим, ×0,5 за лес под целью — но НЕ ×0,5 за Ближний бой.
      SQUAD_TYPES.mediumInfantry.health - Math.round(SQUAD_TYPES.archer.damage * 2 * 0.5),
    );
  });

  test("лучник в лесу не достаёт Прямой наводкой соседний НЕлесной Гекс", () => {
    const adjacent = neighbour(SHOOTER, 0);
    const state = withTarget(adjacent, { [key(SHOOTER)]: "forest" });

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "outOfRange",
    );
  });

  test("лучник на крайнем Гексе леса стреляет за пределы леса свободно", () => {
    const target = at(9, 7);
    const state = withTarget(target, { [key(SHOOTER)]: "forest" });

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage * 2);
  });

  test("лучник в глубине леса за его пределы не стреляет", () => {
    const target = at(9, 7);
    const state = withTarget(target, forestAround(SHOOTER));

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "outOfRange",
    );
  });
});

describe("Лес: Зона провокации", () => {
  test("Зона провокации лесного лучника сужается вместе с его Навесом", () => {
    const entry = at(9, 7);
    const from = at(10, 7);
    const state = battle(
      [
        { id: "sentry", side: "red", type: "archer", hex: SHOOTER, facing: 0 },
        { id: "prov", side: "blue", type: "mediumInfantry", hex: from, facing: 3 },
      ],
      { [key(SHOOTER)]: "forest", [key(entry)]: "forest" },
    );

    // prov входит на лесной Гекс, который выпал из Навеса лесного лучника —
    // значит Оппортун не взводится и Фаза не наступает.
    const moved = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    assert.notEqual(moved.phase.kind, "opportunity");
    assert.equal(moved.armedThreats.length, 0);
  });

  test("нелесной Гекс в конусе лесного лучника Оппортун по-прежнему взводит", () => {
    const entry = at(9, 7);
    const from = at(10, 7);
    const state = battle(
      [
        { id: "sentry", side: "red", type: "archer", hex: SHOOTER, facing: 0 },
        { id: "prov", side: "blue", type: "mediumInfantry", hex: from, facing: 3 },
      ],
      { [key(SHOOTER)]: "forest" },
    );

    const moved = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    assert.equal(moved.armedThreats.length, 1);
  });
});
