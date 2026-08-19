import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById } from "./index.ts";
import { distanceToEdge } from "./rout.ts";
import type { BattleState, Board, Hex, Intent, Side, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

/** Синие уходят на север, красные на юг — расклад статьи. */
const SIDED: Board = { width: 12, height: 12, baggage: { blue: "north", red: "south" } };
const UNSIDED: Board = { width: 12, height: 12 };

const battle = (board: Board, squads: readonly SquadSetup[]): BattleState => start({ board, squads }, {}, 1);

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
 * Прокручивает очередь до Фазы нужного вида у нужного Отряда. Вид указывается
 * явно: `start` вычисляет Фазу открывающего Отряда до того, как тест успевает
 * пометить его бегущим, поэтому первая Фаза партии бывает `turn` там, где
 * сценарию нужен `rout` — и Ход надо прокрутить на круг.
 */
const untilPhase = (state: BattleState, squad: string, kind: "turn" | "rout"): BattleState => {
  let current = state;
  for (let guard = 0; guard < 20; guard++) {
    if (current.phase.kind === kind && current.phase.squad === squad) return current;
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error(`Отряд ${squad} так и не получил Фазу ${kind}`);
};

/** Пересобирает состояние с правками полей Отряда — короткий путь к
 *  полупустому колчану и к обращённому в Бегство Отряду без двадцати ударов. */
const withSquadPatch = (state: BattleState, id: string, patch: Partial<BattleState["squads"][number]>): BattleState => ({
  ...state,
  squads: state.squads.map((squad) => (squad.id === id ? { ...squad, ...patch } : squad)),
});

// Направления: 0 В, 1 ЮВ, 2 ЮЗ, 3 З, 4 СЗ, 5 СВ. Фронт — пара соседей от
// самого Направления, поэтому facing 4 смотрит строго на север (оба Гекса
// Фронта уменьшают row), а facing 1 — строго на юг.
const NORTHWARD = 4 as const;
const SOUTHWARD = 1 as const;

describe("Обоз принадлежит стороне", () => {
  test("дальнобойный Отряд пополняет Боезапас на краю Обоза своей стороны", () => {
    const state = withSquadPatch(
      battle(SIDED, [
        { id: "archer", side: "blue", type: "archer", hex: at(5, 1), facing: NORTHWARD },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(5, 10), facing: SOUTHWARD },
      ]),
      "archer",
      { ammo: 3 },
    );

    const after = ok(untilPhase(state, "archer", "turn"), { kind: "step", to: at(5, 0) });

    assert.equal(squadById(after, "archer")?.ammo, 8);
    assert.ok(after.log.some((event) => event.kind === "ammoRestocked" && event.squad === "archer"));
  });

  test("на чужом краю Боезапас не пополняется", () => {
    const state = withSquadPatch(
      battle(SIDED, [
        // Синий стрелок у ЮЖНОГО края — это Обоз красных, не его.
        { id: "archer", side: "blue", type: "archer", hex: at(5, 10), facing: SOUTHWARD },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(5, 1), facing: NORTHWARD },
      ]),
      "archer",
      { ammo: 3 },
    );

    const after = ok(untilPhase(state, "archer", "turn"), { kind: "step", to: at(5, 11) });

    assert.equal(squadById(after, "archer")?.ammo, 3);
    assert.ok(!after.log.some((event) => event.kind === "ammoRestocked"));
  });

  test("Карта без объявленного Обоза пополняет на любом краю — прежнее поведение", () => {
    const state = withSquadPatch(
      battle(UNSIDED, [
        { id: "archer", side: "blue", type: "archer", hex: at(5, 10), facing: SOUTHWARD },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(5, 1), facing: NORTHWARD },
      ]),
      "archer",
      { ammo: 3 },
    );

    const after = ok(untilPhase(state, "archer", "turn"), { kind: "step", to: at(5, 11) });

    assert.equal(squadById(after, "archer")?.ammo, 8);
  });
});

describe("Бегство уходит через свой край", () => {
  /** Бегущий синий в глубине карты: до своего севера 9, до чужого юга 2. */
  const runner = (board: Board, facing: 1 | 4): BattleState =>
    withSquadPatch(
      battle(board, [
        { id: "coward", side: "blue", type: "lightSpearman", hex: at(5, 9), facing },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(0, 0), facing: SOUTHWARD },
      ]),
      "coward",
      { routing: true },
    );

  test("свой край дальше чужого — Отряд всё равно идёт к своему", () => {
    const state = untilPhase(runner(SIDED, NORTHWARD), "coward", "rout");
    assert.equal(state.phase.kind, "rout");

    const steps = legalIntents(state).filter((intent) => intent.kind === "step");
    assert.ok(steps.length > 0, "бежать есть куда");

    const from = squadById(state, "coward")!.hex;
    for (const step of steps) {
      assert.ok(
        distanceToEdge(step.to, state.board, "blue") < distanceToEdge(from, state.board, "blue"),
        `шаг в ${step.to.col},${step.to.row} не приближает к своему Обозу`,
      );
      assert.ok(step.to.row < from.row, "шаг обязан идти на север, к своему краю");
    }
  });

  test("шаг к чужому близкому краю отклоняется как не кратчайший", () => {
    const state = untilPhase(runner(SIDED, SOUTHWARD), "coward", "rout");
    const southward = at(5, 10);

    assert.equal(rejected(state, { kind: "step", to: southward }), "notShortestRoute");
  });

  test("без объявленного Обоза тот же шаг законен — прежнее поведение", () => {
    const state = untilPhase(runner(UNSIDED, SOUTHWARD), "coward", "rout");
    const southward = at(5, 10);

    const after = ok(state, { kind: "step", to: southward });
    assert.deepEqual(squadById(after, "coward")?.hex, southward);
  });

  test("Отряд покидает Карту, дойдя до своего края, а не до ближайшего", () => {
    const state = withSquadPatch(
      battle(SIDED, [
        { id: "coward", side: "blue", type: "lightSpearman", hex: at(5, 1), facing: NORTHWARD },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(0, 11), facing: SOUTHWARD },
      ]),
      "coward",
      { routing: true },
    );

    const after = ok(untilPhase(state, "coward", "rout"), { kind: "step", to: at(5, 0) });

    assert.equal(squadById(after, "coward"), undefined);
    assert.ok(after.log.some((event) => event.kind === "squadLeftBoard" && event.squad === "coward"));
    assert.ok(after.departed.some((entry) => entry.squad === "coward" && entry.fate === "routed"));
  });

  test("выход на чужой край с Карты не снимает", () => {
    const state = withSquadPatch(
      battle(SIDED, [
        // Синий в шаге от ЮЖНОГО края — это Обоз красных. Для него юг не выход.
        { id: "coward", side: "blue", type: "lightSpearman", hex: at(5, 10), facing: SOUTHWARD },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(0, 0), facing: NORTHWARD },
      ]),
      "coward",
      { routing: true },
    );

    // Юг для него не кратчайший маршрут — шаг туда вовсе незаконен.
    assert.equal(rejected(untilPhase(state, "coward", "rout"), { kind: "step", to: at(5, 11) }), "notShortestRoute");
  });
});

describe("distanceToEdge", () => {
  const board = SIDED;

  test("без стороны считает до ближайшего края доски", () => {
    assert.equal(distanceToEdge(at(5, 9), board), 2); // до юга
    assert.equal(distanceToEdge(at(1, 5), board), 1); // до запада
  });

  test("со стороной считает до Обоза именно этой стороны", () => {
    const sides: readonly Side[] = ["blue", "red"];
    assert.deepEqual(
      sides.map((side) => distanceToEdge(at(5, 9), board, side)),
      [9, 2],
    );
  });

  test("сторона без объявленного Обоза откатывается к ближайшему краю", () => {
    assert.equal(distanceToEdge(at(5, 9), UNSIDED, "blue"), 2);
  });
});
