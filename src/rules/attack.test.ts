import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById, SQUAD_TYPES } from "./index.ts";
import { neighbour, sides } from "./hex.ts";
import type { BattleState, Facing, Hex, Intent, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[]): BattleState =>
  start({ board: { width: 12, height: 12 }, squads }, {}, 1);

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

/**
 * Атакующий стоит в (5,5) лицом на восток; защитник — на первом Гексе его Фронта,
 * с Направлением, которое подставляет заданную сторону.
 */
const duel = (
  attackerType: SquadSetup["type"],
  defenderType: SquadSetup["type"],
  defenderFacing: Facing,
): { state: BattleState; target: Hex } => {
  const target = sides(at(5, 5), 0).front[0];
  if (target === undefined) throw new Error("unreachable");
  return {
    state: battle([
      { id: "attacker", side: "blue", type: attackerType, hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: defenderType, hex: target, facing: defenderFacing },
    ]),
    target,
  };
};

/** Направление, при котором Гекс `from` оказывается Тылом Отряда в `hex`. */
const facingAwayFrom = (hex: Hex, from: Hex): Facing => {
  for (let facing = 0; facing < 6; facing++) {
    const split = sides(hex, facing as Facing);
    if (split.rear.some((candidate) => candidate.col === from.col && candidate.row === from.row)) {
      return facing as Facing;
    }
  }
  throw new Error("unreachable");
};

const facingFlankTo = (hex: Hex, from: Hex): Facing => {
  for (let facing = 0; facing < 6; facing++) {
    const split = sides(hex, facing as Facing);
    if (split.flank.some((candidate) => candidate.col === from.col && candidate.row === from.row)) {
      return facing as Facing;
    }
  }
  throw new Error("unreachable");
};

/** Прокручивает Ходы, пока доска не дождётся решения нужного Отряда. */
const untilActive = (state: BattleState, squad: string): BattleState => {
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    if (current.phase.kind === "turn" && current.phase.squad === squad) return current;
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error(`Отряд ${squad} так и не получил Ход`);
};

/** Тяжёлая пехота против горстки лучников: один удар снимает их целиком. */
const fragileTarget = (): BattleState => {
  const target = sides(at(5, 5), 0).front[0]!;
  return battle([
    { id: "attacker", side: "blue", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
    { id: "defender", side: "red", type: "archer", hex: target, facing: 3, headcount: 10 },
    { id: "survivor", side: "red", type: "heavySpearman", hex: at(11, 11), facing: 0 },
  ]);
};

describe("Атака ближнего боя", () => {
  test("атака во Фронт снимает Здоровье и Мораль на величину Урона", () => {
    const { state } = duel("mediumInfantry", "mediumSpearman", 3);
    const after = ok(state, { kind: "attack", target: "defender" });
    const defender = squadById(after, "defender");
    const damage = SQUAD_TYPES.mediumInfantry.damage;

    assert.equal(defender?.health, SQUAD_TYPES.mediumSpearman.health - damage);
    assert.equal(defender?.morale, SQUAD_TYPES.mediumSpearman.morale - damage);
  });

  test("удар во Фланг усиливает только моральный урон", () => {
    const target = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "attacker", side: "blue", type: "mediumInfantry", hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: "mediumSpearman", hex: target, facing: facingFlankTo(target, at(5, 5)) },
    ]);
    const defender = squadById(ok(state, { kind: "attack", target: "defender" }), "defender");
    const damage = SQUAD_TYPES.mediumInfantry.damage;

    assert.equal(defender?.health, SQUAD_TYPES.mediumSpearman.health - damage);
    assert.equal(defender?.morale, SQUAD_TYPES.mediumSpearman.morale - Math.round(damage * 1.25));
  });

  test("удар в Тыл усиливает моральный урон сильнее", () => {
    // Не ударная пехота — та читает свой удар в Тыл как удар по Флангу
    // (особенность Прорыва, тикет 08), что смазало бы именно эту проверку.
    const target = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "attacker", side: "blue", type: "heavyCavalry", hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: "mediumSpearman", hex: target, facing: facingAwayFrom(target, at(5, 5)) },
    ]);
    const defender = squadById(ok(state, { kind: "attack", target: "defender" }), "defender");
    const damage = SQUAD_TYPES.heavyCavalry.damage;

    assert.equal(defender?.morale, SQUAD_TYPES.mediumSpearman.morale - Math.round(damage * 1.5));
  });

  test("атака завершает Ход: перемещаться после неё нельзя", () => {
    // Ни ударная пехота (дала бы Фазу Прорыва), ни кавалерия (Маневренность
    // как раз разрешает ей двигаться после Атаки — это проверяется отдельно).
    const { state } = duel("mediumSpearman", "mediumSpearman", 3);
    const attacked = ok(state, { kind: "attack", target: "defender" });

    assert.equal(rejected(attacked, { kind: "rotate", facing: 2 }), "alreadyAttacked");
    assert.equal(
      rejected(attacked, { kind: "step", to: sides(at(5, 5), 0).front[1]! }),
      "alreadyAttacked",
    );
  });

  test("повторная атака в том же Ходу отклоняется", () => {
    const { state } = duel("heavyCavalry", "mediumSpearman", 3);
    const attacked = ok(state, { kind: "attack", target: "defender" });

    assert.equal(rejected(attacked, { kind: "attack", target: "defender" }), "alreadyAttacked");
  });

  test("атака мимо Фронта отклоняется", () => {
    const behind = neighbour(at(5, 5), 3);
    const state = battle([
      { id: "attacker", side: "blue", type: "mediumInfantry", hex: at(5, 5), facing: 0 },
      { id: "defender", side: "red", type: "mediumSpearman", hex: behind, facing: 0 },
    ]);

    assert.equal(rejected(state, { kind: "attack", target: "defender" }), "notInFront");
  });

  test("атака по союзнику отклоняется", () => {
    const target = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "attacker", side: "blue", type: "mediumInfantry", hex: at(5, 5), facing: 0 },
      { id: "friend", side: "blue", type: "mediumSpearman", hex: target, facing: 3 },
    ]);

    assert.equal(rejected(state, { kind: "attack", target: "friend" }), "notAnEnemy");
  });

  test("Отряд с нулевым Здоровьем уничтожается и снимается с доски", () => {
    const state = untilActive(fragileTarget(), "attacker");
    const after = ok(state, { kind: "attack", target: "defender" });

    assert.equal(squadById(after, "defender"), undefined);
    assert.ok(after.log.some((event) => event.kind === "squadDestroyed" && event.squad === "defender"));
  });

  test("очередь перешагивает уничтоженный Отряд в середине Раунда", () => {
    // Кавалерия Скорости 5 ходит первой и сносит лучников; после неё в очереди
    // ещё стоит копейщик, поэтому Раунд не успевает перестроить очередь.
    const state = battle([
      { id: "horse", side: "blue", type: "lightCavalry", hex: at(4, 4), facing: 0 },
      { id: "victim", side: "red", type: "archer", hex: sides(at(4, 4), 0).front[0]!, facing: 3, headcount: 10 },
      { id: "slowpoke", side: "red", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);

    const afterKill = ok(state, { kind: "attack", target: "victim" });
    const next = ok(afterKill, { kind: "endTurn" });

    assert.equal(next.phase.kind === "turn" ? next.phase.squad : undefined, "slowpoke");
    assert.doesNotThrow(() => legalIntents(next));
  });

  test("уничтоженный Отряд выпадает из очереди Хода", () => {
    const state = untilActive(fragileTarget(), "attacker");
    const after = ok(ok(state, { kind: "attack", target: "defender" }), { kind: "endTurn" });

    // Ход достаётся следующему живому, а уничтоженный просто пропускается.
    assert.equal(after.phase.kind === "turn" ? after.phase.squad : undefined, "survivor");
    assert.equal(squadById(after, "defender"), undefined);
  });

  test("израненный Отряд наносит половину Урона", () => {
    // Ударная пехота ходит раньше копейщиков при равной Скорости, поэтому красный
    // бьёт первым. Три Раунда сбивают копейщику Здоровье со 160 до 70 — ниже половины.
    // Атакующий — ударная пехота, так что каждый удар предлагает Прорыв; тест не
    // о нём, поэтому предложение просто отклоняется.
    const target = sides(at(5, 5), 0).front[0]!;
    let state: BattleState = battle([
      { id: "wounded", side: "blue", type: "heavySpearman", hex: target, facing: 3 },
      { id: "bully", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
    ]);

    for (let round = 0; round < 3; round++) {
      state = ok(state, { kind: "attack", target: "wounded" }); // ход красного
      if (state.phase.kind === "breakthrough") state = ok(state, { kind: "breakthrough", push: false });
      state = ok(state, { kind: "endTurn" });
      state = ok(state, { kind: "endTurn" }); // синий пропускает
    }

    assert.equal(squadById(state, "wounded")?.health, 160 - 90);

    const bullyHealth = squadById(state, "bully")?.health ?? 0;
    state = ok(state, { kind: "endTurn" }); // красный пропускает, ходит израненный синий
    const after = ok(state, { kind: "attack", target: "bully" });

    // Урон 18, но Отряд ниже половины Здоровья бьёт вполсилы: 9.
    assert.equal(squadById(after, "bully")?.health, bullyHealth - 9);
  });

  test("legalIntents перечисляет достижимые цели атаки", () => {
    const { state } = duel("mediumInfantry", "mediumSpearman", 3);
    const attacks = legalIntents(state).filter((intent) => intent.kind === "attack");

    assert.deepEqual(attacks, [{ kind: "attack", target: "defender" }]);
  });
});
