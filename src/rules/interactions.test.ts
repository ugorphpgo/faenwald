/**
 * Взаимодействия правил: места, где два по отдельности верных механизма
 * складываются неверно. Найдены ревью ядра после закрытия всех десяти тикетов.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById } from "./index.ts";
import { neighbour } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[]): BattleState =>
  start({ board: { width: 14, height: 14 }, squads }, {}, 1);

const ok = (state: BattleState, intent: Intent): BattleState => {
  const applied = apply(state, intent);
  assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

const untilActive = (state: BattleState, squad: string): BattleState => {
  let current = state;
  for (let guard = 0; guard < 24; guard++) {
    if (current.phase.kind === "turn" && current.phase.squad === squad) return current;
    current = ok(current, { kind: "endTurn" });
  }
  throw new Error(`Отряд ${squad} так и не получил Ход`);
};

describe("Активный Отряд, погибший от чужого ответа", () => {
  /** Горстка пехоты бросается на тяжёлых копейщиков и гибнет от Контратаки. */
  const suicidalAttack = (): BattleState => {
    const attackerHex = at(7, 7);
    const defenderHex = neighbour(attackerHex, 0);
    return battle([
      { id: "att", side: "blue", type: "lightInfantry", hex: attackerHex, facing: 0, headcount: 5 },
      { id: "def", side: "red", type: "heavySpearman", hex: defenderHex, facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);
  };

  test("Бой остаётся пригодным к игре, а не падает", () => {
    const after = ok(untilActive(suicidalAttack(), "att"), { kind: "attack", target: "def" });

    assert.equal(squadById(after, "att"), undefined, "атакующий погиб от Контратаки");
    assert.doesNotThrow(() => legalIntents(after));
  });

  test("Ход уходит дальше по очереди, а не остаётся за погибшим", () => {
    const after = ok(untilActive(suicidalAttack(), "att"), { kind: "attack", target: "def" });

    assert.notEqual(after.phase.kind === "turn" ? after.phase.squad : undefined, "att");
    // Доска продолжает принимать намерения.
    assert.ok(legalIntents(after).length > 0);
  });
});

describe("Активный Отряд, сломленный на собственном Ходу", () => {
  test("Фаза переключается на Бегство, а не остаётся обычным Ходом", () => {
    // Копейщик-заморыш бьёт в Тыл тяжёлой пехоте и ловит Контратаку, которая
    // ломает ему Мораль, не убивая.
    const attackerHex = at(7, 7);
    const defenderHex = neighbour(attackerHex, 0);
    const state = battle([
      { id: "att", side: "blue", type: "lightSpearman", hex: attackerHex, facing: 0, headcount: 20 },
      { id: "def", side: "red", type: "heavyInfantry", hex: defenderHex, facing: 3 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);

    const after = ok(untilActive(state, "att"), { kind: "attack", target: "def" });
    const attacker = squadById(after, "att");

    if (attacker !== undefined && attacker.routing) {
      assert.equal(after.phase.kind, "rout", "сломленный Отряд должен доигрывать Ход по правилам Бегства");
    }
    assert.doesNotThrow(() => legalIntents(after));
  });
});

describe("Оппортун расходует Ход держателя", () => {
  /** Часовой сторожит Гекс к западу от себя; провокатор идёт прямо на него. */
  const sentryLane = (): { state: BattleState; entry: Hex } => {
    const sentryHex = at(7, 7);
    const entry = neighbour(sentryHex, 3);
    return {
      state: battle([
        { id: "sentry", side: "red", type: "lightSpearman", hex: sentryHex, facing: 3 },
        { id: "prov", side: "blue", type: "lightSpearman", hex: neighbour(entry, 3), facing: 0 },
      ]),
      entry,
    };
  };

  const strikeOpportunity = (): BattleState => {
    const { state, entry } = sentryLane();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    return ok(opportunity, { kind: "opportunity", strike: true });
  };

  test("ударивший Оппортуном приходит на свой Ход уже потратившим Атаку", () => {
    // Статья: «атаковавший оппортуном считается отходившим; после удара он
    // может только развернуться».
    const struck = strikeOpportunity();
    assert.equal(squadById(struck, "sentry")?.spent.attacked, true);

    const ownTurn = untilActive(struck, "sentry");
    assert.equal(
      squadById(ownTurn, "sentry")?.spent.attacked,
      true,
      "списание Атаки обязано пережить чужой Ход и дожить до собственного",
    );
  });

  test("и на своём Ходу второй раз не бьёт", () => {
    const ownTurn = untilActive(strikeOpportunity(), "sentry");
    const applied = apply(ownTurn, { kind: "attack", target: "prov" });

    assert.equal(applied.ok, false);
    if (applied.ok) throw new Error("unreachable");
    assert.equal(applied.reason.kind, "alreadyAttacked");
  });

  test("но развернуться после Оппортуна может — это статья разрешает прямо", () => {
    const struck = strikeOpportunity();
    const ownTurn = untilActive(struck, "sentry");
    const facing = squadById(ownTurn, "sentry")?.facing ?? 0;
    const applied = apply(ownTurn, { kind: "rotate", facing: (((facing + 1) % 6) as 0 | 1 | 2 | 3 | 4 | 5) });

    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });
});

describe("Отложенное намерение, ставшее незаконным", () => {
  test("Удар Оппортуна не откатывается, даже если отложенное намерение отклонено", () => {
    // Провокатор объявляет Ускорение; Оппортун сбивает ему Мораль ниже цены
    // Ускорения, и отложенное намерение исполнить уже нельзя.
    const sentryHex = at(7, 7);
    const entry = neighbour(sentryHex, 3);
    const state = battle([
      { id: "sentry", side: "red", type: "heavyInfantry", hex: sentryHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: neighbour(entry, 3), facing: 0, headcount: 20 },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const moraleBefore = squadById(armed, "prov")?.morale ?? 0;

    const declared = apply(armed, { kind: "surge" });
    assert.ok(declared.ok);
    if (!declared.ok) throw new Error("unreachable");
    assert.equal(declared.state.phase.kind, "opportunity");

    const struck = apply(declared.state, { kind: "opportunity", strike: true });
    assert.ok(struck.ok, "ответ держателя обязан пройти, чем бы ни кончилось отложенное намерение");
    if (!struck.ok) throw new Error("unreachable");

    const provoker = squadById(struck.state, "prov");
    // Удар состоялся: Мораль просела. Раньше здесь весь ответ откатывался.
    assert.ok(
      provoker === undefined || provoker.morale < moraleBefore,
      "Удар Оппортуна обязан остаться в состоянии",
    );
    assert.ok(struck.state.log.some((event) => event.kind === "opportunityStrike"));
  });
});
