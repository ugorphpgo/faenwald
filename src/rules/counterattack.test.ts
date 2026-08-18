import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import { sides } from "./hex.ts";
import type { BattleState, Facing, Hex, Intent, PolicyOverrides, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[], policies: PolicyOverrides = {}): BattleState =>
  start({ board: { width: 12, height: 12 }, squads }, policies, 1);

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

/** Направление, при котором Гекс `from` оказывается Флангом Отряда в `hex`. */
const facingFlankTo = (hex: Hex, from: Hex): Facing => {
  for (let facing = 0; facing < 6; facing++) {
    const split = sides(hex, facing as Facing);
    if (split.flank.some((candidate) => candidate.col === from.col && candidate.row === from.row)) {
      return facing as Facing;
    }
  }
  throw new Error("unreachable");
};

const untilActive = (state: BattleState, squad: string): BattleState => {
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    if (current.phase.kind === "turn" && current.phase.squad === squad) return current;
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error(`Отряд ${squad} так и не получил Ход`);
};

/**
 * Атакующий у (5,5) лицом на восток; защитник — на первом Гексе его Фронта,
 * facing3 смотрит прямо назад на атакующего — взаимный лобовой удар.
 */
const frontDuel = (
  attackerType: SquadSetup["type"],
  defenderType: SquadSetup["type"],
  extra: readonly SquadSetup[] = [],
  policies: PolicyOverrides = {},
): { state: BattleState; target: Hex } => {
  const target = sides(at(5, 5), 0).front[0]!;
  return {
    state: battle(
      [
        { id: "attacker", side: "blue", type: attackerType, hex: at(5, 5), facing: 0 },
        { id: "defender", side: "red", type: defenderType, hex: target, facing: 3 },
        ...extra,
      ],
      policies,
    ),
    target,
  };
};

describe("Контратака: срабатывание", () => {
  test("защитник, атакованный в ближнем бою во Фронт, отвечает автоматически", () => {
    const { state } = frontDuel("mediumInfantry", "mediumSpearman");
    const after = ok(state, { kind: "attack", target: "defender" });

    const damage = SQUAD_TYPES.mediumInfantry.damage; // 25
    const counter = SQUAD_TYPES.mediumSpearman.damage; // 15

    assert.equal(squadById(after, "defender")?.health, SQUAD_TYPES.mediumSpearman.health - damage);
    assert.equal(squadById(after, "defender")?.morale, SQUAD_TYPES.mediumSpearman.morale - damage);
    assert.equal(squadById(after, "attacker")?.health, SQUAD_TYPES.mediumInfantry.health - counter);
    assert.equal(squadById(after, "attacker")?.morale, SQUAD_TYPES.mediumInfantry.morale - counter);
  });

  test("удар во Фланг Контратаки не вызывает", () => {
    const target = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "attacker", side: "blue", type: "mediumInfantry", hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: "mediumSpearman", hex: target, facing: facingFlankTo(target, at(5, 5)) },
    ]);
    const after = ok(state, { kind: "attack", target: "defender" });

    assert.equal(squadById(after, "attacker")?.health, SQUAD_TYPES.mediumInfantry.health);
    assert.equal(squadById(after, "attacker")?.morale, SQUAD_TYPES.mediumInfantry.morale);
  });

  test("удар в Тыл Контратаки не вызывает", () => {
    const target = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "attacker", side: "blue", type: "mediumInfantry", hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: "mediumSpearman", hex: target, facing: 0 },
    ]);
    const after = ok(state, { kind: "attack", target: "defender" });

    assert.equal(squadById(after, "attacker")?.health, SQUAD_TYPES.mediumInfantry.health);
    assert.equal(squadById(after, "attacker")?.morale, SQUAD_TYPES.mediumInfantry.morale);
  });

  test("Контратака гасится, если Мораль защитника обнулилась до физического урона", () => {
    // lightSpearman, урезанный до 20 солдат: Здоровье 16, Мораль 14. Удар mediumSpearman
    // (15 урона) снимает 15 и Здоровья, и Морали — защитник выживает (1 > 0), но Мораль
    // уходит в минус раньше, чем успевает ответить.
    const target = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "attacker", side: "blue", type: "mediumSpearman", hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: "lightSpearman", hex: target, facing: 3, headcount: 20 },
    ]);
    // lightSpearman (Скорость 3) быстрее mediumSpearman (Скорость 2) и обычно ходил
    // бы первым — прокручиваем до Хода атакующего явно.
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });

    assert.equal(squadById(after, "defender")?.health, 1);
    assert.equal(squadById(after, "defender")?.routing, true);
    assert.equal(squadById(after, "attacker")?.health, SQUAD_TYPES.mediumSpearman.health);
    assert.equal(squadById(after, "attacker")?.morale, SQUAD_TYPES.mediumSpearman.morale);
  });

  test("к исходной Атаке применяется обычный модификатор Тип против Типа, а Контратака на него не претендует", () => {
    // lightCavalry несёт ×1,5 исходящего урона по дальнобойным — атакующий здесь
    // именно она (дальнобойные с ticket07 обычной Атакой не пользуются вовсе).
    // Ответная Контратака archer'а своего множителя не имеет — идёт голым Уроном.
    const { state } = frontDuel("lightCavalry", "archer");
    const after = ok(state, { kind: "attack", target: "defender" });

    // 10 × 1.5 = 15, а не голых 10.
    assert.equal(squadById(after, "defender")?.health, SQUAD_TYPES.archer.health - 15);
    assert.equal(squadById(after, "defender")?.morale, SQUAD_TYPES.archer.morale - 15);
    assert.equal(squadById(after, "attacker")?.health, SQUAD_TYPES.lightCavalry.health - SQUAD_TYPES.archer.damage);
    assert.equal(squadById(after, "attacker")?.morale, SQUAD_TYPES.lightCavalry.morale - SQUAD_TYPES.archer.damage);
  });

  test("Контратака может уничтожить атакующего", () => {
    const { state } = frontDuel(
      "lightInfantry",
      "heavySpearman",
      [{ id: "anchor", side: "blue", type: "heavySpearman", hex: at(11, 11), facing: 0 }],
    );
    const shrunk: BattleState = {
      ...state,
      squads: state.squads.map((squad) =>
        squad.id === "attacker" ? { ...squad, health: 10, morale: 14 } : squad,
      ),
    };
    const after = ok(shrunk, { kind: "attack", target: "defender" });

    assert.equal(squadById(after, "attacker"), undefined);
    assert.ok(after.log.some((event) => event.kind === "squadDestroyed" && event.squad === "attacker"));
  });
});

describe("Контратака: политика расхода атаки", () => {
  // Лёгкая кавалерия (Скорость 5) ходит раньше тяжёлого копейщика (Скорость 1),
  // поэтому Контратака происходит на чужом Ходу до того, как копейщик получит свой.
  const setup = (policies: PolicyOverrides) => {
    const target = sides(at(5, 5), 0).front[0]!;
    return battle(
      [
        { id: "horse", side: "blue", type: "lightCavalry", hex: at(5, 5), facing: 0 },
        { id: "spear", side: "red", type: "heavySpearman", hex: target, facing: 3 },
      ],
      policies,
    );
  };

  test("политика хранится в состоянии и переживает сериализацию", () => {
    const state = setup({ counterattackSpendsDefendersAttack: true });
    assert.equal(state.policies.counterattackSpendsDefendersAttack, true);

    const revived = JSON.parse(JSON.stringify(state)) as BattleState;
    assert.equal(revived.policies.counterattackSpendsDefendersAttack, true);
  });

  test("при включённой политике защитник теряет атаку на своём Ходу", () => {
    const state = setup({ counterattackSpendsDefendersAttack: true });
    const afterCounter = ok(state, { kind: "attack", target: "spear" });
    const spearsTurn = untilActive(ok(afterCounter, { kind: "endTurn" }), "spear");

    assert.equal(rejected(spearsTurn, { kind: "attack", target: "horse" }), "alreadyAttacked");
  });

  test("при выключенной политике защитник сохраняет право атаковать", () => {
    const state = setup({ counterattackSpendsDefendersAttack: false });
    const afterCounter = ok(state, { kind: "attack", target: "spear" });
    const spearsTurn = untilActive(ok(afterCounter, { kind: "endTurn" }), "spear");

    const applied = apply(spearsTurn, { kind: "attack", target: "horse" });
    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });

  test("списанная политикой атака не переносится на следующий Раунд", () => {
    // После Хода копейщика приходит новый Раунд; списание должно было сгореть,
    // и на второй Раунд копейщик снова может атаковать.
    const state = setup({ counterattackSpendsDefendersAttack: true });
    const afterCounter = ok(state, { kind: "attack", target: "spear" });
    let current = untilActive(ok(afterCounter, { kind: "endTurn" }), "spear");
    assert.equal(rejected(current, { kind: "attack", target: "horse" }), "alreadyAttacked");

    current = ok(current, { kind: "endTurn" }); // Раунд 1 закрыт, копейщик пропустил атаку
    current = untilActive(current, "spear"); // Раунд 2: копейщик снова активен

    const applied = apply(current, { kind: "attack", target: "horse" });
    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });
});
