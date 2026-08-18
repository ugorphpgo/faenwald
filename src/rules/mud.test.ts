import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import { sides } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";
import type { TerrainId } from "./catalog/terrain.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[], terrain: Readonly<Record<string, TerrainId>>): BattleState =>
  start({ board: { width: 12, height: 12, terrain }, squads }, {}, 1);

const ok = (state: BattleState, intent: Intent): BattleState => {
  const applied = apply(state, intent);
  assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

const untilActive = (state: BattleState, squad: string): BattleState => {
  let current = state;
  for (let guard = 0; guard < 10; guard++) {
    if (current.phase.kind === "turn" && current.phase.squad === squad) return current;
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error(`Отряд ${squad} так и не получил Ход`);
};

/** attacker и defender стоят лицом друг к другу: attacker во Фронте defender,
 *  defender во Фронте attacker. Терраин на их Гексах задаётся отдельно для
 *  каждого — так проверяется условие «оба в грязи». */
const facedOff = (
  attackerType: SquadSetup["type"],
  defenderType: SquadSetup["type"],
  attackerTerrain: TerrainId | undefined,
  defenderTerrain: TerrainId | undefined,
): BattleState => {
  const defenderHex = at(5, 5);
  const attackerHex = sides(defenderHex, 0).front[0]!;
  const terrain: Record<string, TerrainId> = {};
  if (defenderTerrain !== undefined) terrain[`${defenderHex.col},${defenderHex.row}`] = defenderTerrain;
  if (attackerTerrain !== undefined) terrain[`${attackerHex.col},${attackerHex.row}`] = attackerTerrain;

  const state = battle(
    [
      { id: "defender", side: "blue", type: defenderType, hex: defenderHex, facing: 0 },
      { id: "attacker", side: "red", type: attackerType, hex: attackerHex, facing: 3 },
    ],
    terrain,
  );
  return untilActive(state, "attacker");
};

const strike = (state: BattleState): number => {
  const before = squadById(state, "defender")!.health;
  const after = ok(state, { kind: "attack", target: "defender" });
  return before - squadById(after, "defender")!.health;
};

describe("Грязь и вес", () => {
  test("лёгкий по тяжёлому, оба в грязи: ×2", () => {
    const dealt = strike(facedOff("lightSpearman", "heavySpearman", "mud", "mud"));
    assert.equal(dealt, Math.round(SQUAD_TYPES.lightSpearman.damage * 2));
  });

  test("множитель применяется один раз, а не дважды", () => {
    const dealt = strike(facedOff("lightSpearman", "heavySpearman", "mud", "mud"));
    assert.notEqual(dealt, Math.round(SQUAD_TYPES.lightSpearman.damage * 4));
  });

  test("тяжёлый по лёгкому в грязи: множителя нет", () => {
    const dealt = strike(facedOff("heavySpearman", "lightSpearman", "mud", "mud"));
    assert.equal(dealt, SQUAD_TYPES.heavySpearman.damage);
  });

  test("атакующий в грязи, цель на равнине: множителя нет", () => {
    const dealt = strike(facedOff("lightSpearman", "heavySpearman", "mud", undefined));
    assert.equal(dealt, SQUAD_TYPES.lightSpearman.damage);
  });

  test("цель в грязи, атакующий на равнине: множителя нет", () => {
    const dealt = strike(facedOff("lightSpearman", "heavySpearman", undefined, "mud"));
    assert.equal(dealt, SQUAD_TYPES.lightSpearman.damage);
  });

  test("средний вес атакующего: множителя нет", () => {
    const dealt = strike(facedOff("mediumSpearman", "heavySpearman", "mud", "mud"));
    assert.equal(dealt, SQUAD_TYPES.mediumSpearman.damage);
  });

  test("средний вес цели: множителя нет", () => {
    const dealt = strike(facedOff("lightSpearman", "mediumSpearman", "mud", "mud"));
    assert.equal(dealt, SQUAD_TYPES.lightSpearman.damage);
  });

  test("Топь считается грязью для этого правила", () => {
    const dealt = strike(facedOff("lightSpearman", "heavySpearman", "swamp", "swamp"));
    assert.equal(dealt, Math.round(SQUAD_TYPES.lightSpearman.damage * 2));
  });

  test("множитель действует и на моральный урон — тот же общий конвейер", () => {
    const state = facedOff("lightSpearman", "heavySpearman", "mud", "mud");
    const before = squadById(state, "defender")!.morale;
    const after = ok(state, { kind: "attack", target: "defender" });
    const moraleLost = before - squadById(after, "defender")!.morale;
    assert.equal(moraleLost, Math.round(SQUAD_TYPES.lightSpearman.damage * 2));
  });
});
