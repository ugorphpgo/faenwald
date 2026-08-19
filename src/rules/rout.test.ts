import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById, SQUAD_TYPES } from "./index.ts";
import { distanceToEdge } from "./rout.ts";
import { sides } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[], size = 12): BattleState =>
  start({ board: { width: size, height: size }, squads }, {}, 1);

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

/** Бьёт по цели, пока её Мораль не обнулится. Отклоняет любое предложение
 *  Прорыва по пути — этот файл про Бегство, не про ударную пехоту. */
const grindMorale = (state: BattleState, attacker: string, target: string): BattleState => {
  let current = state;
  for (let guard = 0; guard < 40; guard++) {
    const victim = squadById(current, target);
    if (victim === undefined || victim.routing) return current;
    if (current.phase.kind === "turn" && current.phase.squad === attacker) {
      const struck = apply(current, { kind: "attack", target });
      current = struck.ok ? struck.state : ok(current, { kind: "endTurn" });
    }
    if (current.phase.kind === "breakthrough") current = ok(current, { kind: "breakthrough", push: false });
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error("Мораль так и не обнулилась");
};

describe("Бегство", () => {
  /** Слабый духом лучник впритык к тяжёлой пехоте у самого края карты. */
  const brittle = (): BattleState => {
    const target = sides(at(5, 5), 0).front[0]!;
    // Копейщик: Мораль 70 ниже Здоровья 80, а удар в Тыл бьёт по Морали ×1,5 —
    // поэтому он сломается раньше, чем погибнет.
    return battle([
      { id: "bully", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
      { id: "coward", side: "blue", type: "lightSpearman", hex: target, facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 10), facing: 0 },
    ]);
  };

  test("Отряд с нулевой Моралью обращается в Бегство, а не уничтожается", () => {
    const state = grindMorale(brittle(), "bully", "coward");
    const coward = squadById(state, "coward");

    assert.ok(coward !== undefined, "бежавший Отряд остаётся на доске");
    assert.equal(coward?.routing, true);
    assert.ok(state.log.some((event) => event.kind === "squadRouted" && event.squad === "coward"));
  });

  // Карты этого файла Обоз не объявляют, поэтому «свой край» здесь означает
  // «любой ближайший» — умолчание тикета 09. Сторонний Обоз и его последствия
  // для кратчайшего маршрута проверяет `baggage.test.ts`.
  test("в Фазе Бегства законны только шаги к ближайшему краю (Карта без Обоза)", () => {
    let state = grindMorale(brittle(), "bully", "coward");
    while (!(state.phase.kind === "rout" && state.phase.squad === "coward")) {
      state = ok(state, { kind: "endTurn" });
    }
    assert.equal(state.board.baggage, undefined, "тест опирается на умолчание, Обоз не объявлен");

    const steps = legalIntents(state).filter((intent) => intent.kind === "step");
    assert.ok(steps.length > 0, "бежать есть куда");

    const from = squadById(state, "coward")!.hex;
    for (const step of steps) {
      assert.ok(
        distanceToEdge(step.to, state.board, "blue") < distanceToEdge(from, state.board, "blue"),
        `шаг в ${step.to.col},${step.to.row} не приближает к краю`,
      );
    }
  });

  test("бежавший Отряд не атакует", () => {
    let state = grindMorale(brittle(), "bully", "coward");
    while (!(state.phase.kind === "rout" && state.phase.squad === "coward")) {
      state = ok(state, { kind: "endTurn" });
    }

    assert.equal(rejected(state, { kind: "attack", target: "bully" }), "routing");
  });

  test("дойдя до края, Отряд покидает карту", () => {
    // Копейщик стоит в шаге от западного края спиной к врагу: удары в Тыл бьют по
    // Морали ×1,5, поэтому он сломается раньше, чем погибнет, и ему останется один шаг.
    const state = battle([
      { id: "coward", side: "blue", type: "lightSpearman", hex: at(1, 5), facing: 3 },
      { id: "bully", side: "red", type: "heavyInfantry", hex: at(2, 5), facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(9, 9), facing: 0 },
    ]);

    let current = grindMorale(state, "bully", "coward");
    assert.equal(squadById(current, "coward")?.routing, true);

    while (!(current.phase.kind === "rout" && current.phase.squad === "coward")) {
      current = ok(current, { kind: "endTurn" });
    }
    const escaped = ok(current, { kind: "step", to: at(0, 5) });

    assert.equal(squadById(escaped, "coward"), undefined);
    assert.ok(escaped.log.some((event) => event.kind === "squadLeftBoard" && event.squad === "coward"));
    assert.ok(escaped.departed.some((entry) => entry.squad === "coward" && entry.fate === "routed"));
  });
});

describe("Мораль окружения", () => {
  test("гибель Отряда снимает Мораль у соседей и стоящих через Гекс", () => {
    const victimHex = sides(at(5, 5), 0).front[0]!;
    const neighbour = sides(victimHex, 0).front[0]!;
    const farther = sides(neighbour, 0).front[0]!;

    const state = battle([
      { id: "killer", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
      { id: "victim", side: "blue", type: "archer", hex: victimHex, facing: 3, headcount: 10 },
      { id: "near", side: "blue", type: "heavySpearman", hex: neighbour, facing: 3 },
      { id: "far", side: "blue", type: "heavySpearman", hex: farther, facing: 3 },
    ]);

    const before = { near: squadById(state, "near")!.morale, far: squadById(state, "far")!.morale };
    let current = state;
    while (!(current.phase.kind === "turn" && current.phase.squad === "killer")) {
      current = ok(current, { kind: "endTurn" });
    }
    const after = ok(current, { kind: "attack", target: "victim" });

    assert.equal(squadById(after, "near")?.morale, before.near - 10);
    assert.equal(squadById(after, "far")?.morale, before.far - 5);
  });
});

describe("Правитель", () => {
  test("присутствие Правителя даёт его Отрядам +10 Морали", () => {
    const state = battle([
      { id: "lord", side: "blue", type: "heavySpearman", hex: at(2, 2), facing: 0, ruler: true },
      { id: "levy", side: "blue", type: "lightSpearman", hex: at(3, 3), facing: 0 },
      { id: "foe", side: "red", type: "lightSpearman", hex: at(8, 8), facing: 0 },
    ]);

    assert.equal(squadById(state, "levy")?.morale, SQUAD_TYPES.lightSpearman.morale + 10);
    assert.equal(squadById(state, "lord")?.morale, SQUAD_TYPES.heavySpearman.morale + 10);
    assert.equal(squadById(state, "foe")?.morale, SQUAD_TYPES.lightSpearman.morale);
  });

  test("гибель Отряда Правителя удваивает штраф соседям и бросает д3", () => {
    const lordHex = sides(at(5, 5), 0).front[0]!;
    const neighbour = sides(lordHex, 0).front[0]!;

    const state = battle([
      { id: "killer", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
      { id: "lord", side: "blue", type: "archer", hex: lordHex, facing: 3, headcount: 10, ruler: true },
      { id: "near", side: "blue", type: "heavySpearman", hex: neighbour, facing: 3 },
    ]);

    let current = state;
    while (!(current.phase.kind === "turn" && current.phase.squad === "killer")) {
      current = ok(current, { kind: "endTurn" });
    }
    const before = squadById(current, "near")!.morale;
    const after = ok(current, { kind: "attack", target: "lord" });

    // −20 за гибель Отряда Правителя и −10 за то, что Правитель ушёл с поля.
    assert.equal(squadById(after, "near")?.morale, before - 20 - 10);
    assert.ok(after.log.some((event) => event.kind === "rulerFate"));
  });

  test("судьба Правителя детерминирована зерном", () => {
    const build = (seed: number): BattleState => {
      const lordHex = sides(at(5, 5), 0).front[0]!;
      return start(
        {
          board: { width: 12, height: 12 },
          squads: [
            { id: "killer", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
            { id: "lord", side: "blue", type: "archer", hex: lordHex, facing: 3, headcount: 10, ruler: true },
          ],
        },
        {},
        seed,
      );
    };
    const fateOf = (seed: number): string => {
      let current = build(seed);
      while (!(current.phase.kind === "turn" && current.phase.squad === "killer")) {
        current = ok(current, { kind: "endTurn" });
      }
      const after = ok(current, { kind: "attack", target: "lord" });
      const event = after.log.find((entry) => entry.kind === "rulerFate");
      assert.ok(event !== undefined && event.kind === "rulerFate");
      return event.kind === "rulerFate" ? event.fate : "";
    };

    assert.equal(fateOf(7), fateOf(7));
    assert.ok(["killed", "captured", "fled"].includes(fateOf(7)));
  });
});

describe("Конец Боя и Отчёт", () => {
  test("Бой заканчивается, когда у стороны не осталось Отрядов", () => {
    const victimHex = sides(at(5, 5), 0).front[0]!;
    const state = battle([
      { id: "killer", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
      { id: "victim", side: "blue", type: "archer", hex: victimHex, facing: 3, headcount: 10 },
    ]);

    let current = state;
    while (!(current.phase.kind === "turn" && current.phase.squad === "killer")) {
      current = ok(current, { kind: "endTurn" });
    }
    const after = ok(current, { kind: "attack", target: "victim" });

    assert.equal(after.phase.kind, "over");
    if (after.phase.kind !== "over") throw new Error("unreachable");
    assert.equal(after.phase.report.winner, "red");
  });

  test("после конца Боя любое намерение отклоняется", () => {
    const victimHex = sides(at(5, 5), 0).front[0]!;
    let state = battle([
      { id: "killer", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
      { id: "victim", side: "blue", type: "archer", hex: victimHex, facing: 3, headcount: 10 },
    ]);
    while (!(state.phase.kind === "turn" && state.phase.squad === "killer")) {
      state = ok(state, { kind: "endTurn" });
    }
    const over = ok(state, { kind: "attack", target: "victim" });

    assert.equal(rejected(over, { kind: "endTurn" }), "battleOver");
  });

  test("Потери: уничтоженный теряется целиком, уцелевший — половину отнятого Здоровья", () => {
    const victimHex = sides(at(5, 5), 0).front[0]!;
    let state = battle([
      { id: "killer", side: "red", type: "heavyInfantry", hex: at(5, 5), facing: 0 },
      { id: "victim", side: "blue", type: "archer", hex: victimHex, facing: 3, headcount: 10 },
    ]);
    while (!(state.phase.kind === "turn" && state.phase.squad === "killer")) {
      state = ok(state, { kind: "endTurn" });
    }
    const over = ok(state, { kind: "attack", target: "victim" });
    if (over.phase.kind !== "over") throw new Error("unreachable");

    const victim = over.phase.report.squads.find((entry) => entry.squad === "victim");
    assert.equal(victim?.fate, "destroyed");
    assert.equal(victim?.casualties, 10);

    const killer = over.phase.report.squads.find((entry) => entry.squad === "killer");
    assert.equal(killer?.fate, "survived");
    assert.equal(killer?.casualties, 0);
  });

  test("сторона может капитулировать", () => {
    const state = battle([
      { id: "blue", side: "blue", type: "heavySpearman", hex: at(2, 2), facing: 0 },
      { id: "red", side: "red", type: "heavySpearman", hex: at(8, 8), facing: 0 },
    ]);
    const over = ok(state, { kind: "concede" });

    assert.equal(over.phase.kind, "over");
    if (over.phase.kind !== "over") throw new Error("unreachable");
    assert.equal(over.phase.report.winner, "red");
  });
});
