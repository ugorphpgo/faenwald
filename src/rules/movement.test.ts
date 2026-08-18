import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById } from "./index.ts";
import { sides } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";
import type { TerrainId } from "./catalog/terrain.ts";

const key = (hex: Hex): string => `${hex.col},${hex.row}`;

/** Красный наблюдатель в дальнем углу: без противника Бой заканчивается, не начавшись.
 *  Тяжёлый копейщик Скорости 1 ходит последним, поэтому очередь всегда открывает mover. */
const SENTINEL: SquadSetup = { id: "sentinel", side: "red", type: "heavySpearman", hex: { col: 11, row: 11 }, facing: 0 };

const battle = (
  squads: readonly SquadSetup[],
  terrain: Readonly<Record<string, TerrainId>> = {},
): BattleState => start({ board: { width: 12, height: 12, terrain }, squads: [...squads, SENTINEL] }, {}, 1);

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

const mover = (type: SquadSetup["type"], hex: Hex, facing: SquadSetup["facing"] = 0): SquadSetup => ({
  id: "mover",
  side: "blue",
  type,
  hex,
  facing,
});

const at = (col: number, row: number): Hex => ({ col, row });

describe("Перемещение", () => {
  test("шаг в Гекс Фронта тратит единицу Запаса хода", () => {
    const state = battle([mover("lightSpearman", at(5, 5))]);
    const before = squadById(state, "mover");
    assert.equal(before?.movement, 3);

    const target = sides(at(5, 5), 0).front[0];
    if (target === undefined) throw new Error("unreachable");
    const after = squadById(ok(state, { kind: "step", to: target }), "mover");

    assert.equal(key(after!.hex), key(target));
    assert.equal(after?.movement, 2);
  });

  test("шаг мимо Фронта отклоняется", () => {
    // Не копейщик — у копейщиков есть отдельная способность шагать в Тыл и
    // Фланг, проверенная своим набором тестов ниже.
    const state = battle([mover("lightCavalry", at(5, 5))]);
    const behind = sides(at(5, 5), 0).rear[0];
    if (behind === undefined) throw new Error("unreachable");

    assert.equal(rejected(state, { kind: "step", to: behind }), "notInFront");
  });

  test("шаг в занятый Гекс отклоняется", () => {
    const target = sides(at(5, 5), 0).front[0];
    if (target === undefined) throw new Error("unreachable");
    const state = battle([
      mover("lightSpearman", at(5, 5)),
      { id: "blocker", side: "red", type: "archer", hex: target, facing: 3 },
    ]);
    const movers = state.phase.kind === "turn" && state.phase.squad === "mover" ? state : ok(state, { kind: "endTurn" });

    assert.equal(rejected(movers, { kind: "step", to: target }), "hexOccupied");
  });

  test("гора и вода непроходимы", () => {
    const front = sides(at(5, 5), 0).front;
    const [rock, sea] = front;
    if (rock === undefined || sea === undefined) throw new Error("unreachable");
    const state = battle([mover("lightSpearman", at(5, 5))], {
      [key(rock)]: "mountain",
      [key(sea)]: "water",
    });

    assert.equal(rejected(state, { kind: "step", to: rock }), "impassable");
    assert.equal(rejected(state, { kind: "step", to: sea }), "impassable");
  });

  test("зимой вода проходима и стоит как равнина", () => {
    const [sea] = sides(at(5, 5), 0).front;
    if (sea === undefined) throw new Error("unreachable");
    const state = start(
      {
        board: { width: 12, height: 12, terrain: { [key(sea)]: "water" } },
        squads: [mover("lightSpearman", at(5, 5)), SENTINEL],
        season: "winter",
      },
      {},
      1,
    );

    const after = ok(state, { kind: "step", to: sea });
    assert.equal(squadById(after, "mover")?.movement, 2); // 3 - 1, как по равнине
  });

  test("зимой гора остаётся непроходимой", () => {
    const [rock] = sides(at(5, 5), 0).front;
    if (rock === undefined) throw new Error("unreachable");
    const state = start(
      {
        board: { width: 12, height: 12, terrain: { [key(rock)]: "mountain" } },
        squads: [mover("lightSpearman", at(5, 5)), SENTINEL],
        season: "winter",
      },
      {},
      1,
    );

    assert.equal(rejected(state, { kind: "step", to: rock }), "impassable");
  });

  test("шаг без Запаса хода отклоняется", () => {
    const state = battle([mover("heavySpearman", at(5, 5))]);
    const target = sides(at(5, 5), 0).front[0];
    if (target === undefined) throw new Error("unreachable");
    const spent = ok(state, { kind: "step", to: target });

    const next = sides(target, 0).front[0];
    if (next === undefined) throw new Error("unreachable");
    assert.equal(rejected(spent, { kind: "step", to: next }), "noMovement");
  });

  test("legalIntents перечисляет достижимые Гексы", () => {
    const state = battle([mover("lightSpearman", at(5, 5))]);
    const steps = legalIntents(state).filter((intent) => intent.kind === "step");

    assert.deepEqual(
      steps.map((intent) => key(intent.to)).sort(),
      sides(at(5, 5), 0).front.map(key).sort(),
    );
  });
});

describe("Разворот", () => {
  test("поворот тратит единицу Запаса хода и меняет стороны", () => {
    const state = battle([mover("lightSpearman", at(5, 5))]);
    const after = squadById(ok(state, { kind: "rotate", facing: 3 }), "mover");

    assert.equal(after?.facing, 3);
    assert.equal(after?.movement, 2);
  });

  test("тяжёлый Отряд поворачивается бесплатно один раз за Ход", () => {
    const state = battle([mover("heavySpearman", at(5, 5))]);
    const once = ok(state, { kind: "rotate", facing: 1 });
    assert.equal(squadById(once, "mover")?.movement, 1);

    const twice = ok(once, { kind: "rotate", facing: 2 });
    assert.equal(squadById(twice, "mover")?.movement, 0);
  });

  test("поворот в текущее Направление отклоняется", () => {
    const state = battle([mover("lightSpearman", at(5, 5), 2)]);
    assert.equal(rejected(state, { kind: "rotate", facing: 2 }), "sameFacing");
  });
});

describe("Местность", () => {
  const frontOf = (hex: Hex): Hex => {
    const target = sides(hex, 0).front[0];
    if (target === undefined) throw new Error("unreachable");
    return target;
  };

  test("дорога стоит вдвое дешевле", () => {
    const target = frontOf(at(5, 5));
    const state = battle([mover("lightSpearman", at(5, 5))], { [key(target)]: "road" });

    assert.equal(squadById(ok(state, { kind: "step", to: target }), "mover")?.movement, 2.5);
  });

  test("грязь стоит вдвое дороже, топь втрое", () => {
    const target = frontOf(at(5, 5));
    const mud = battle([mover("lightSpearman", at(5, 5))], { [key(target)]: "mud" });
    const swamp = battle([mover("lightSpearman", at(5, 5))], { [key(target)]: "swamp" });

    assert.equal(squadById(ok(mud, { kind: "step", to: target }), "mover")?.movement, 1);
    assert.equal(squadById(ok(swamp, { kind: "step", to: target }), "mover")?.movement, 0);
  });

  test("заросли стоят кавалерии два Гекса, а пехоте один", () => {
    const target = frontOf(at(5, 5));
    const horse = battle([mover("lightCavalry", at(5, 5))], { [key(target)]: "thicket" });
    const foot = battle([mover("lightSpearman", at(5, 5))], { [key(target)]: "thicket" });

    assert.equal(squadById(ok(horse, { kind: "step", to: target }), "mover")?.movement, 3);
    assert.equal(squadById(ok(foot, { kind: "step", to: target }), "mover")?.movement, 2);
  });

  test("в лесу кавалерия проходит только один Гекс за Ход", () => {
    const target = frontOf(at(5, 5));
    const state = battle([mover("lightCavalry", at(5, 5))], { [key(target)]: "forest" });
    const stepped = ok(state, { kind: "step", to: target });

    assert.equal(squadById(stepped, "mover")?.movement, 0);
    assert.equal(rejected(stepped, { kind: "step", to: frontOf(target) }), "noMovement");
  });

  test("неизрасходованная дробь Запаса хода копится между Ходами", () => {
    // Тяжёлый копейщик Скорости 1 не может войти в грязь стоимостью 2 сразу,
    // но накопит за два Хода.
    const target = frontOf(at(5, 5));
    const state = battle([mover("heavySpearman", at(5, 5))], { [key(target)]: "mud" });
    assert.equal(rejected(state, { kind: "step", to: target }), "noMovement");

    const nextTurn = ok(ok(state, { kind: "endTurn" }), { kind: "endTurn" });
    assert.equal(squadById(nextTurn, "mover")?.movement, 2);
    assert.equal(key(squadById(ok(nextTurn, { kind: "step", to: target }), "mover")!.hex), key(target));
  });
});

describe("Накопление Запаса хода", () => {
  const frontOf = (hex: Hex): Hex => {
    const target = sides(hex, 0).front[0];
    if (target === undefined) throw new Error("unreachable");
    return target;
  };

  const withPolicy = (
    carriesWholeHexes: boolean,
    terrain: Readonly<Record<string, TerrainId>>,
  ): BattleState =>
    start(
      { board: { width: 12, height: 12, terrain }, squads: [mover("heavySpearman", at(5, 5)), SENTINEL] },
      { movementCarriesWholeHexes: carriesWholeHexes },
      1,
    );

  test("перенос целых Гексов включён по умолчанию", () => {
    assert.equal(battle([mover("lightSpearman", at(5, 5))]).policies.movementCarriesWholeHexes, true);
  });

  test("перенос ограничен одной Скоростью, а не копится бесконечно", () => {
    // Скорость 1: сколько Ходов ни стой, Запас хода не перевалит за 2.
    let state = battle([mover("heavySpearman", at(5, 5))]);
    for (let round = 0; round < 4; round++) state = ok(ok(state, { kind: "endTurn" }), { kind: "endTurn" });

    assert.equal(squadById(state, "mover")?.movement, 2);
  });

  test("дробь копится в целый Гекс за два Хода", () => {
    // Дорога стоит 0,5: тяжёлый копейщик Скорости 1 после шага по дороге
    // сохраняет 0,5 и на следующем Ходу имеет 1,5.
    const road = frontOf(at(5, 5));
    const state = battle([mover("heavySpearman", at(5, 5))], { [key(road)]: "road" });
    const stepped = ok(state, { kind: "step", to: road });
    assert.equal(squadById(stepped, "mover")?.movement, 0.5);

    const nextTurn = ok(ok(stepped, { kind: "endTurn" }), { kind: "endTurn" });
    assert.equal(squadById(nextTurn, "mover")?.movement, 1.5);
  });

  test("под буквой статьи целая часть сгорает, и подъём становится недостижим", () => {
    // Ровно тот случай, ради которого заведена политика: Скорость 1 против
    // подъёма стоимостью 2. Сколько ни стой — Запас хода застывает на 1.
    const climb = frontOf(at(5, 5));
    let state = withPolicy(false, { [key(climb)]: "foothill" });
    for (let round = 0; round < 4; round++) state = ok(ok(state, { kind: "endTurn" }), { kind: "endTurn" });

    assert.equal(squadById(state, "mover")?.movement, 1);
    assert.equal(rejected(state, { kind: "step", to: climb }), "noMovement");
  });

  test("под буквой статьи дробь всё равно копится", () => {
    const road = frontOf(at(5, 5));
    const state = withPolicy(false, { [key(road)]: "road" });
    const stepped = ok(state, { kind: "step", to: road });
    assert.equal(squadById(stepped, "mover")?.movement, 0.5);

    const nextTurn = ok(ok(stepped, { kind: "endTurn" }), { kind: "endTurn" });
    assert.equal(squadById(nextTurn, "mover")?.movement, 1.5);
  });

  test("политика попадает в состояние и переживает сериализацию", () => {
    const state = withPolicy(false, {});
    const revived = JSON.parse(JSON.stringify(state)) as BattleState;
    assert.equal(revived.policies.movementCarriesWholeHexes, false);
  });
});

describe("Поселение и кавалерия", () => {
  test("кавалерия, начинающая Ход в Поселении, получает Запас хода на 2 меньше", () => {
    const home = at(5, 5);
    const state = battle([mover("lightCavalry", home)], { [key(home)]: "settlement" });

    assert.equal(squadById(state, "mover")?.movement, 3); // 5 - 2
  });

  test("копейщики, ударная пехота и дальнобойные в Поселении Запас хода не теряют", () => {
    const home = at(5, 5);
    const spear = battle([mover("heavySpearman", home)], { [key(home)]: "settlement" });
    const shock = battle([mover("mediumInfantry", home)], { [key(home)]: "settlement" });
    const ranged = battle([mover("archer", home)], { [key(home)]: "settlement" });

    assert.equal(squadById(spear, "mover")?.movement, 1);
    assert.equal(squadById(shock, "mover")?.movement, 2);
    assert.equal(squadById(ranged, "mover")?.movement, 3);
  });

  test("Очерёдность Хода штраф не меняет", () => {
    const settlementHex = at(5, 5);
    const state = start(
      {
        board: { width: 12, height: 12, terrain: { [key(settlementHex)]: "settlement" } },
        squads: [
          { id: "capped", side: "blue", type: "lightCavalry", hex: settlementHex, facing: 0 },
          { id: "free", side: "red", type: "mediumCavalry", hex: at(1, 1), facing: 0 },
        ],
      },
      {},
      1,
    );

    // lightCavalry (Скорость 5) быстрее mediumCavalry (4) в очереди Хода,
    // несмотря на то что его Запас хода урезан Поселением: Инициатива
    // считается по каталожной Скорости, не по текущему Запасу хода.
    assert.deepEqual(state.order, ["capped", "free"]);
  });

  test("Ускорение удваивает уже урезанный остаток, а не полный", () => {
    const home = at(5, 5);
    const state = battle([mover("lightCavalry", home)], { [key(home)]: "settlement" });
    assert.equal(squadById(state, "mover")?.movement, 3);

    const surged = ok(state, { kind: "surge" });
    assert.equal(squadById(surged, "mover")?.movement, 6); // 3 × 2, не 5 × 2
  });
});

describe("Ускорение", () => {
  test("удваивает остаток Запаса хода за 10 Морали", () => {
    const state = battle([mover("lightSpearman", at(5, 5))]);
    const surged = ok(state, { kind: "surge" });
    const squad = squadById(surged, "mover");

    assert.equal(squad?.movement, 6);
    assert.equal(squad?.morale, 60);
  });

  test("удваивает только остаток, если применено в середине Хода", () => {
    const state = battle([mover("lightSpearman", at(5, 5))]);
    const stepped = ok(state, { kind: "step", to: sides(at(5, 5), 0).front[0]! });
    const surged = ok(stepped, { kind: "surge" });

    assert.equal(squadById(surged, "mover")?.movement, 4);
  });

  test("не применяется дважды за Ход", () => {
    const state = battle([mover("lightSpearman", at(5, 5))]);
    assert.equal(rejected(ok(state, { kind: "surge" }), { kind: "surge" }), "alreadySurged");
  });

  test("кавалерия в лесу не может ускоряться", () => {
    const state = battle([mover("lightCavalry", at(5, 5))], { [key(at(5, 5))]: "forest" });
    assert.equal(rejected(state, { kind: "surge" }), "surgeBlocked");
  });

  test("не применяется при нехватке Морали", () => {
    const state = battle([{ ...mover("lightSpearman", at(5, 5)), headcount: 10 }]);
    assert.equal(squadById(state, "mover")?.morale, 7);
    assert.equal(rejected(state, { kind: "surge" }), "notEnoughMorale");
  });
});
