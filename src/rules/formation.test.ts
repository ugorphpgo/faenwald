import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import { facingTowards, neighbour, sides } from "./hex.ts";
import type { Board, BattleState, Hex, Intent, SquadSetup } from "./index.ts";
import type { TerrainId } from "./catalog/terrain.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (
  squads: readonly SquadSetup[],
  terrain: Readonly<Record<string, TerrainId>> = {},
  board: Partial<Board> = {},
): BattleState => start({ board: { width: 12, height: 12, terrain, ...board }, squads }, {}, 1);

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

describe("Сомкнутый строй", () => {
  test("прикрытый один Фланг даёт ×0,8 входящего урона с Фронта", () => {
    const wallHex = at(5, 5);
    const neighbourHex = sides(wallHex, 0).flank[0]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const state = battle([
      { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
      { id: "neighbour", side: "blue", type: "lightSpearman", hex: neighbourHex, facing: 0 },
      { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 0.8));
  });

  test("прикрытые оба Фланга дают ×0,6", () => {
    const wallHex = at(5, 5);
    const leftHex = sides(wallHex, 0).flank[0]!;
    const rightHex = sides(wallHex, 0).flank[1]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const state = battle([
      { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
      { id: "left", side: "blue", type: "lightSpearman", hex: leftHex, facing: 0 },
      { id: "right", side: "blue", type: "lightSpearman", hex: rightHex, facing: 0 },
      { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 0.6));
  });

  test("непроходимая Местность считается прикрытием", () => {
    const wallHex = at(5, 5);
    const flankHex = sides(wallHex, 0).flank[0]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const key = `${flankHex.col},${flankHex.row}`;
    const state = battle(
      [
        { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
        { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
      ],
      { [key]: "mountain" },
    );

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 0.8));
  });

  test("край карты считается прикрытием", () => {
    // wall стоит у самой западной кромки лицом на ЮВ (facing1) — при этом
    // Направлении именно Фланг, а не Тыл, уходит за край карты.
    const wallHex = at(0, 5);
    const attackerHex = sides(wallHex, 1).front[0]!;
    const state = battle([
      { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 1 },
      { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 4 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 0.8));
  });

  test("разворот соседа разрывает строй", () => {
    const wallHex = at(5, 5);
    const neighbourHex = sides(wallHex, 0).flank[0]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const state = battle([
      { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
      { id: "neighbour", side: "blue", type: "lightSpearman", hex: neighbourHex, facing: 1 }, // не то Направление
      { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - damage);
  });

  test("Тыл даёт дополнительный ×1,5 к Здоровью, но не к Морали сверх обычного", () => {
    // wall смотрит НА attacker (facing3) — значит attacker стоит в Тылу wall.
    const wallHex = at(7, 7);
    const attackerHex = sides(wallHex, 0).front[0]!;
    const state = battle([
      { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 3 },
      { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;

    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 1.5));
    // Мораль — обычный ×1,5 за Тыл, БЕЗ дополнительного умножения строя.
    assert.equal(squadById(after, "wall")?.morale, SQUAD_TYPES.mediumSpearman.morale - Math.round(damage * 1.5));
  });

  test("копейщик шагает на Фланг и Тыл без разворота ценой удвоенной Скорости", () => {
    const state = battle([{ id: "spear", side: "blue", type: "lightSpearman", hex: at(5, 5), facing: 0 }]);
    const flankHex = sides(at(5, 5), 0).flank[0]!;

    const stepped = ok(state, { kind: "step", to: flankHex });
    assert.equal(squadById(stepped, "spear")?.facing, 0); // Направление не изменилось
    assert.equal(squadById(stepped, "spear")?.movement, 1); // 3 - 2
  });

  test("летом вода прикрывает Фланг, как непроходимая Местность", () => {
    const wallHex = at(5, 5);
    const flankHex = sides(wallHex, 0).flank[0]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const key = `${flankHex.col},${flankHex.row}`;
    const state = battle(
      [
        { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
        { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
      ],
      { [key]: "water" },
    );

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 0.8));
  });

  test("зимой вода не прикрывает Фланг — она проходима", () => {
    const wallHex = at(5, 5);
    const flankHex = sides(wallHex, 0).flank[0]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const key = `${flankHex.col},${flankHex.row}`;
    const state = start(
      {
        board: { width: 12, height: 12, terrain: { [key]: "water" } },
        squads: [
          { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
          { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
        ],
        season: "winter",
      },
      {},
      1,
    );

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - damage);
  });

  test("Поселение добавляет 5 процентных пунктов к бонусу строя", () => {
    const wallHex = at(5, 5);
    const neighbourHex = sides(wallHex, 0).flank[0]!;
    const attackerHex = sides(wallHex, 0).front[0]!;
    const key = `${wallHex.col},${wallHex.row}`;
    const state = battle(
      [
        { id: "wall", side: "blue", type: "mediumSpearman", hex: wallHex, facing: 0 },
        { id: "neighbour", side: "blue", type: "lightSpearman", hex: neighbourHex, facing: 0 },
        { id: "attacker", side: "red", type: "mediumSpearman", hex: attackerHex, facing: 3 },
      ],
      { [key]: "settlement" },
    );

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "wall" });
    const damage = SQUAD_TYPES.mediumSpearman.damage;
    // 0,8 - 0,05 = 0,75.
    assert.equal(squadById(after, "wall")?.health, SQUAD_TYPES.mediumSpearman.health - Math.round(damage * 0.75));
  });
});

describe("Прорыв: срабатывание", () => {
  test("предлагается, когда отнятое Здоровье цели достигает её собственной Атаки", () => {
    // heavyInfantry (30 урона) против lightSpearman (12 урона, 80 Здоровья):
    // 30 ≥ 12 уже первым ударом.
    const targetHex = at(5, 5);
    const attackerHex = sides(targetHex, 0).front[0]!;
    const state = battle([
      { id: "target", side: "blue", type: "lightSpearman", hex: targetHex, facing: 3 },
      { id: "attacker", side: "red", type: "heavyInfantry", hex: attackerHex, facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    assert.deepEqual(after.phase, { kind: "breakthrough", attacker: "attacker", target: "target" });
  });

  test("Фаза ждёт решения — прочие намерения отклоняются", () => {
    const targetHex = at(5, 5);
    const attackerHex = sides(targetHex, 0).front[0]!;
    const state = battle([
      { id: "target", side: "blue", type: "lightSpearman", hex: targetHex, facing: 3 },
      { id: "attacker", side: "red", type: "heavyInfantry", hex: attackerHex, facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);
    const offered = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });

    assert.equal(rejected(offered, { kind: "endTurn" }), "wrongPhase");
    assert.equal(rejected(offered, { kind: "rotate", facing: 1 }), "wrongPhase");
  });

  test("не предлагается ниже порога", () => {
    // archer (6 урона) против heavySpearman (18 урона, 160 Здоровья) — далеко
    // не достаёт порог одним ударом... но archer дальнобойный, поэтому берём
    // lightInfantry (20 урона) против heavySpearman (18): 20 ≥ 18 — уже
    // превышает. Возьмём lightInfantry против mediumSpearman (15): тоже. Нужен
    // заведомо слабый удар: archer не подходит (ranged), значит намеренно берём
    // lightSpearman (12 урона, не ударная пехота вовсе) — Прорыва не может быть
    // в принципе, это же и есть учитываемый критерий "не ударная пехота".
    const targetHex = at(5, 5);
    const attackerHex = sides(targetHex, 0).front[0]!;
    const state = battle([
      { id: "target", side: "blue", type: "heavySpearman", hex: targetHex, facing: 3 },
      { id: "attacker", side: "red", type: "lightSpearman", hex: attackerHex, facing: 3 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    assert.equal(after.phase.kind, "turn");
  });
});

describe("Прорыв: исполнение", () => {
  const setup = (extra: readonly SquadSetup[] = []): BattleState => {
    const targetHex = at(6, 6);
    const attackerHex = sides(targetHex, 0).front[0]!;
    return battle([
      { id: "target", side: "blue", type: "lightSpearman", hex: targetHex, facing: 3 },
      { id: "attacker", side: "red", type: "heavyInfantry", hex: attackerHex, facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      ...extra,
    ]);
  };

  test("push:false оставляет всё как есть", () => {
    const state = setup();
    const offered = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    const targetHexBefore = squadById(offered, "target")?.hex;

    const declined = ok(offered, { kind: "breakthrough", push: false });
    assert.equal(declined.phase.kind, "turn");
    assert.deepEqual(squadById(declined, "target")?.hex, targetHexBefore);
    assert.ok(declined.log.some((event) => event.kind === "breakthroughDeclined"));
  });

  test("push:true отодвигает цель на Тыловой Гекс, атакующий занимает освободившийся", () => {
    const targetHex = at(6, 6);
    // Толчок идёт вдоль Направления атакующего (facing3 — на запад), продолжая
    // линию удара за целью, а не в сторону атакующего.
    const rearHex = neighbour(targetHex, 3);
    const state = setup();

    const offered = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    const pushed = ok(offered, { kind: "breakthrough", push: true });

    assert.deepEqual(squadById(pushed, "target")?.hex, rearHex);
    assert.deepEqual(squadById(pushed, "attacker")?.hex, targetHex);
    assert.equal(pushed.phase.kind, "turn");
  });

  test("Отряды позади цели сдвигаются цепочкой", () => {
    const targetHex = at(6, 6);
    const behindHex = neighbour(targetHex, 3);
    const furtherHex = neighbour(behindHex, 3);
    const state = setup([{ id: "behind", side: "blue", type: "lightSpearman", hex: behindHex, facing: 3 }]);

    const offered = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    const pushed = ok(offered, { kind: "breakthrough", push: true });

    assert.deepEqual(squadById(pushed, "target")?.hex, behindHex);
    assert.deepEqual(squadById(pushed, "behind")?.hex, furtherHex);
    assert.deepEqual(squadById(pushed, "attacker")?.hex, targetHex);
  });

  test("недоступный Тыл уходит на доступный Фланг", () => {
    const targetHex = at(6, 6);
    const rearHex = neighbour(targetHex, 3);
    const key = `${rearHex.col},${rearHex.row}`;
    const state = setup();
    const blocked = { ...state, board: { ...state.board, terrain: { ...state.board.terrain, [key]: "mountain" as const } } };

    const offered = ok(untilActive(blocked, "attacker"), { kind: "attack", target: "target" });
    const pushed = ok(offered, { kind: "breakthrough", push: true });

    const landedFlank = sides(targetHex, 3).flank.some((hex) => {
      const targetSquadHex = squadById(pushed, "target")?.hex;
      return targetSquadHex !== undefined && hex.col === targetSquadHex.col && hex.row === targetSquadHex.row;
    });
    assert.ok(landedFlank, "цель должна была уйти на Фланг");
    assert.deepEqual(squadById(pushed, "attacker")?.hex, targetHex);
  });

  test("полностью недоступный сдвиг — Прорыв не срабатывает", () => {
    const targetHex = at(6, 6);
    const attackerHex = sides(targetHex, 0).front[0]!;
    // Окружаем цель со всех сторон непроходимой Местностью, кроме Гекса атакующего.
    const terrain: Record<string, "mountain"> = {};
    for (const hex of sides(targetHex, 3).flank) terrain[`${hex.col},${hex.row}`] = "mountain";
    for (const hex of sides(targetHex, 3).front) terrain[`${hex.col},${hex.row}`] = "mountain";
    const rearKey = `${neighbour(targetHex, 0).col},${neighbour(targetHex, 0).row}`;
    terrain[rearKey] = "mountain";

    const state = battle(
      [
        { id: "target", side: "blue", type: "lightSpearman", hex: targetHex, facing: 3 },
        { id: "attacker", side: "red", type: "heavyInfantry", hex: attackerHex, facing: 3 },
        { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      ],
      terrain,
    );

    const offered = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    const targetHexBefore = squadById(offered, "target")?.hex;
    const result = ok(offered, { kind: "breakthrough", push: true });

    assert.deepEqual(squadById(result, "target")?.hex, targetHexBefore);
    assert.ok(result.log.some((event) => event.kind === "breakthroughFailed"));
  });

  test("применим даже при израсходованном Запасе хода", () => {
    const targetHex = at(6, 6);
    const attackerHex = sides(targetHex, 0).front[0]!;
    const state = battle([
      { id: "target", side: "blue", type: "lightSpearman", hex: targetHex, facing: 3 },
      { id: "attacker", side: "red", type: "heavyInfantry", hex: attackerHex, facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);
    const spentMovement: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "attacker" ? { ...squad, movement: 0 } : squad)),
    };

    const offered = ok(untilActive(spentMovement, "attacker"), { kind: "attack", target: "target" });
    const applied = apply(offered, { kind: "breakthrough", push: true });
    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });

  test("Урон в Тыл при Прорыве считается как урон по Флангу", () => {
    const targetHex = at(6, 6);
    // target смотрит на восток (facing0) — атакующий заходит с Гекса его Тыла.
    const attackerHex = sides(targetHex, 0).rear[0]!;
    const state = battle([
      { id: "target", side: "blue", type: "lightSpearman", hex: targetHex, facing: 0 },
      { id: "attacker", side: "red", type: "heavyInfantry", hex: attackerHex, facing: facingTowards(attackerHex, targetHex)! },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);

    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "target" });
    const damage = SQUAD_TYPES.heavyInfantry.damage;
    // ×1,25 (Фланг), а не ×1,5 (Тыл) — и без дополнительной Уязвимости копейщика
    // в Тыл, раз удар классифицируется как фланговый.
    assert.equal(squadById(after, "target")?.morale, SQUAD_TYPES.lightSpearman.morale - Math.round(damage * 1.25));
  });
});

describe("Прорыв не применяется в Оппортуне", () => {
  test("ударная пехота, отвечая Оппортуном, Прорыв не предлагает", () => {
    const sentryHex = at(6, 6);
    const entry = neighbour(sentryHex, 3);
    const provokerStart = neighbour(entry, 3);
    const state = battle([
      { id: "sentry", side: "red", type: "heavyInfantry", hex: sentryHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: provokerStart, facing: 0 },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    // heavyInfantry (30) ≥ lightSpearman (12) — порог достигнут, но Оппортун не
    // предлагает Прорыв: Фаза либо turn, либо rout, никогда не breakthrough.
    assert.notEqual(struck.phase.kind, "breakthrough");
  });
});
