import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById, SQUAD_TYPES } from "./index.ts";
import { facingTowards, neighbour } from "./hex.ts";
import type { BattleState, Facing, Hex, Intent, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[]): BattleState =>
  start({ board: { width: 14, height: 14 }, squads }, {}, 1);

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

/**
 * Часовой (lightSpearman, facing3) сторожит Гекс к востоку от себя. Провокатор
 * ставится в двух Гексах западнее часового, лицом на восток (0) — прямо на
 * часового, — так что первый же шаг вперёд входит в Зону провокации.
 */
const sentry = (extra: readonly SquadSetup[] = []): { state: BattleState; sentryHex: Hex; entry: Hex } => {
  const sentryHex = at(6, 6);
  const entry = neighbour(sentryHex, 3); // Гекс сразу к западу от часового.
  const provokerStart = neighbour(entry, 3);
  return {
    state: battle([
      { id: "sentry", side: "red", type: "lightSpearman", hex: sentryHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: provokerStart, facing: 0 },
      ...extra,
    ]),
    sentryHex,
    entry,
  };
};

describe("Оппортун: взведение", () => {
  test("вход в Зону провокации взводит держателю право удара", () => {
    const { state, entry } = sentry();
    const moved = untilActive(state, "prov");
    const stepped = ok(moved, { kind: "step", to: entry });

    assert.deepEqual(stepped.armedThreats, [{ holder: "sentry", against: "prov" }]);
  });

  test("Отряд, не совершающий действий, Оппортуна не провоцирует", () => {
    const { state } = sentry();
    const moved = untilActive(state, "prov");
    const stood = ok(moved, { kind: "endTurn" });

    assert.deepEqual(stood.armedThreats, []);
  });
});

describe("Оппортун: протокол прерывания", () => {
  test("объявление следующего намерения переводит Бой в Фазу Оппортуна", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const declared = apply(armed, { kind: "rotate", facing: 3 });

    assert.ok(declared.ok);
    if (!declared.ok) throw new Error("unreachable");
    assert.deepEqual(declared.state.phase, {
      kind: "opportunity",
      holders: ["sentry"],
      against: "prov",
      deferred: { kind: "rotate", facing: 3 },
    });
  });

  test("Фаза Оппортуна отклоняет любые намерения, кроме ответов держателей", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });

    assert.equal(rejected(opportunity, { kind: "endTurn" }), "wrongPhase");
    assert.equal(rejected(opportunity, { kind: "surge" }), "wrongPhase");
  });

  test("legalIntents в Фазе Оппортуна возвращает только ответы держателя", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });

    assert.deepEqual(legalIntents(opportunity), [
      { kind: "opportunity", strike: true },
      { kind: "opportunity", strike: false },
    ]);
  });

  test("держатель может ударить, и это расходует его право и его Ход", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    const damage = SQUAD_TYPES.lightSpearman.damage;
    assert.equal(squadById(struck, "prov")?.health, SQUAD_TYPES.lightSpearman.health - damage);
    assert.equal(squadById(struck, "sentry")?.spent.attacked, true);
    assert.deepEqual(struck.armedThreats, []);
  });

  test("держатель может отказаться без всяких последствий", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const declined = ok(opportunity, { kind: "opportunity", strike: false });

    assert.equal(squadById(declined, "prov")?.health, SQUAD_TYPES.lightSpearman.health);
    assert.equal(squadById(declined, "sentry")?.spent.attacked, false);
  });

  test("после ответа последнего держателя отложенное намерение исполняется", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const declined = ok(opportunity, { kind: "opportunity", strike: false });

    // Отложенным было rotate facing:3 — оно должно было исполниться.
    assert.equal(declined.phase.kind, "turn");
    assert.equal(squadById(declined, "prov")?.facing, 3);
  });

  test("разворот происходит после удара — удар приходит по Фронту, а не по Тылу", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    // Часовой бил в Фронт (мораль ×1) — если бы удар пришёл уже после разворота
    // (в Тыл), моральный урон был бы ×1.5.
    const damage = SQUAD_TYPES.lightSpearman.damage;
    assert.equal(squadById(struck, "prov")?.morale, SQUAD_TYPES.lightSpearman.morale - damage);
  });

  test("если объявленное намерение — атака по держателю, она исполняется раньше его удара", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const attacked = ok(armed, { kind: "attack", target: "sentry" });

    // Атака провокатора исполнилась немедленно — держателя вообще не спросили.
    assert.equal(attacked.phase.kind, "turn");
    assert.deepEqual(attacked.armedThreats, []);
    const damage = SQUAD_TYPES.lightSpearman.damage;
    assert.equal(squadById(attacked, "sentry")?.health, SQUAD_TYPES.lightSpearman.health - damage);
  });

  test("Отряд, уже атаковавший в этом Раунде, Оппортун наносить не может", () => {
    const sentryHex = at(6, 6);
    const entry = neighbour(sentryHex, 3);
    const provokerStart = neighbour(entry, 3);
    // Другой Гекс Фронта того же часового (facing3 → front = [entry, this]).
    const bystanderTarget = neighbour(sentryHex, 4);
    const state = battle([
      { id: "sentry", side: "red", type: "lightSpearman", hex: sentryHex, facing: 3 },
      { id: "bystander", side: "blue", type: "lightSpearman", hex: bystanderTarget, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: provokerStart, facing: 0 },
    ]);

    // Часовой тратит свою Атаку на постороннего до того, как провокатор дойдёт до него.
    const spentSentry = ok(untilActive(state, "sentry"), { kind: "attack", target: "bystander" });
    const advanced = untilActive(spentSentry, "prov");
    const stepped = ok(advanced, { kind: "step", to: entry });

    assert.deepEqual(stepped.armedThreats, []);
  });

  test("каждый держатель отвечает не более одного раза за Ход провокатора", () => {
    // Второй Гекс того же маршрута всё ещё в Зоне провокации того же часового —
    // право не должно взводиться повторно, пока первое не потрачено.
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    assert.deepEqual(armed.armedThreats, [{ holder: "sentry", against: "prov" }]);

    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const declined = ok(opportunity, { kind: "opportunity", strike: false });

    // Тот же самый шаг ещё раз не взводит право снова, пока оно не расходуется
    // явным ответом — а решение уже принято (declined).
    assert.deepEqual(declined.armedThreats, []);
  });
});

describe("Оппортун: несколько держателей", () => {
  test("оба держателя отвечают по очереди, прежде чем намерение исполнится", () => {
    // entry окружён с двух противоположных сторон часовыми, смотрящими на него,
    // и с третьей стороны — провокатором в одном шаге, тоже смотрящим на entry.
    const entry = at(6, 6);
    const westHolder = neighbour(entry, 3);
    const eastHolder = neighbour(entry, 0);
    const provokerStart = neighbour(entry, 4);
    const state = battle([
      { id: "west", side: "red", type: "lightSpearman", hex: westHolder, facing: facingTowards(westHolder, entry)! },
      { id: "east", side: "red", type: "lightSpearman", hex: eastHolder, facing: facingTowards(eastHolder, entry)! },
      {
        id: "prov",
        side: "blue",
        type: "lightSpearman",
        hex: provokerStart,
        facing: facingTowards(provokerStart, entry)!,
      },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    assert.deepEqual(
      [...armed.armedThreats].sort((a, b) => a.holder.localeCompare(b.holder)),
      [
        { holder: "east", against: "prov" },
        { holder: "west", against: "prov" },
      ],
    );

    const opportunity = ok(armed, { kind: "endTurn" });
    assert.equal(opportunity.phase.kind, "opportunity");
    if (opportunity.phase.kind !== "opportunity") throw new Error("unreachable");
    assert.equal(opportunity.phase.holders.length, 2);

    const firstAnswered = ok(opportunity, { kind: "opportunity", strike: true });
    assert.equal(firstAnswered.phase.kind, "opportunity");

    const secondAnswered = ok(firstAnswered, { kind: "opportunity", strike: true });
    // Оба ударили — двойной Урон снят, и Ход провокатора наконец завершился.
    const damage = SQUAD_TYPES.lightSpearman.damage;
    assert.equal(squadById(secondAnswered, "prov")?.health, SQUAD_TYPES.lightSpearman.health - damage * 2);
    assert.notEqual(secondAnswered.phase.kind, "opportunity");
  });
});

describe("Оппортун: Контратака не провоцируется", () => {
  test("Удар Оппортуна не вызывает встречной Контратаки", () => {
    const { state, entry } = sentry();
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    // sentry не понёс урона — будь тут Контратака, его Здоровье бы просело.
    assert.equal(squadById(struck, "sentry")?.health, SQUAD_TYPES.lightSpearman.health);
  });
});

describe("Оппортун: отложенное намерение и исход провокатора", () => {
  test("отложенное намерение не исполняется, если провокатор уничтожен", () => {
    const holderHex = at(5, 5);
    const entry = neighbour(holderHex, 0);
    const provokerStart = neighbour(entry, 0);
    const state = battle([
      { id: "holder", side: "red", type: "heavyInfantry", hex: holderHex, facing: 0 },
      { id: "prov", side: "blue", type: "archer", hex: provokerStart, facing: 3, headcount: 5 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(12, 12), facing: 0 },
    ]);
    // Хрупкий лучник шагает мимо тяжёлой пехоты и тут же гибнет от её Оппортуна.
    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "endTurn" });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    assert.equal(squadById(struck, "prov"), undefined);
    assert.ok(struck.log.some((event) => event.kind === "squadDestroyed" && event.squad === "prov"));
  });

  test("отложенное намерение не исполняется, если провокатор обращён в Бегство", () => {
    // lightSpearman, урезанный до 20 солдат: Здоровье 16, Мораль 14. Удар
    // mediumSpearman (15 урона, лобовой) снимает 15 и там, и там — провокатор
    // выживает (1 > 0), но Мораль уходит в минус раньше, чем успевает довернуть.
    const holderHex = at(6, 6);
    const entry = neighbour(holderHex, 3);
    const provStart = neighbour(entry, 3);
    const state = battle([
      { id: "holder", side: "red", type: "mediumSpearman", hex: holderHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: provStart, facing: 0, headcount: 20 },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    const provoker = squadById(struck, "prov");
    assert.equal(provoker?.health, 1);
    assert.equal(provoker?.routing, true);
    // Отложенный разворот НЕ исполнился — Направление осталось прежним (0).
    assert.equal(provoker?.facing, 0);
    assert.equal(struck.phase.kind, "rout");
  });
});
