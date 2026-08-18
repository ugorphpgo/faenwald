import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById, SQUAD_TYPES } from "./index.ts";
import { neighbour } from "./hex.ts";
import type { BattleState, Board, Hex, Intent, PolicyOverrides, SquadSetup } from "./index.ts";
import type { TerrainId } from "./catalog/terrain.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (
  squads: readonly SquadSetup[],
  terrain: Readonly<Record<string, TerrainId>> = {},
  board: Partial<Board> = {},
): BattleState =>
  start({ board: { width: 16, height: 16, terrain, ...board }, squads }, {}, 1);

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

/** Стрелок в (7,7) лицом на восток; вторая сторона держит якорь в углу, чтобы
 *  Бой не заканчивался, если стрелка кто-то убьёт. */
const anchoredArcher = (
  type: SquadSetup["type"],
  extra: readonly SquadSetup[] = [],
): SquadSetup[] => [
  { id: "shooter", side: "blue", type, hex: at(7, 7), facing: 0 },
  { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
  ...extra,
];

describe("Навес", () => {
  test("накрывает конус в четыре Гекса перед Фронтом", () => {
    const farTarget = at(11, 7); // 4 Гекса на восток
    // mediumInfantry — без своих модификаторов входящего урона дальнего боя,
    // чтобы число било ровно по режиму, без посторонних множителей.
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "mediumInfantry", hex: farTarget, facing: 3 },
    ]));

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage);
  });

  test("не достаёт цель за пределами четырёх Гексов", () => {
    const tooFar = at(12, 7); // 5 Гексов
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "lightSpearman", hex: tooFar, facing: 3 },
    ]));

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" }),
      "outOfRange",
    );
  });

  test("летит поверх стоящих на пути Отрядов", () => {
    const between = at(9, 7);
    const farTarget = at(11, 7);
    const state = battle(anchoredArcher("archer", [
      { id: "blocker", side: "red", type: "heavySpearman", hex: between, facing: 3 },
      { id: "target", side: "red", type: "mediumInfantry", hex: farTarget, facing: 3 },
    ]));

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage);
    assert.equal(squadById(shot, "blocker")?.health, SQUAD_TYPES.heavySpearman.health);
  });

  test("не может быть нацелен на Отряд в Поселении", () => {
    const target = at(9, 7);
    const state = battle(
      anchoredArcher("archer", [{ id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 }]),
      { [`${target.col},${target.row}`]: "settlement" },
    );

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" }),
      "immuneToArcShot",
    );
  });
});

describe("Прямая наводка", () => {
  test("бьёт ×2 через Гекс", () => {
    const target = at(9, 7); // 2 Гекса на восток
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "mediumInfantry", hex: target, facing: 3 },
    ]));

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage * 2);
  });

  test("отклоняется, если на линии стоит Отряд", () => {
    const between = neighbour(at(7, 7), 0);
    const target = at(9, 7);
    const state = battle(anchoredArcher("archer", [
      { id: "blocker", side: "red", type: "lightSpearman", hex: between, facing: 3 },
      { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
    ]));

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "lineBlocked",
    );
  });

  test("не бьёт мимо своей дальности", () => {
    const adjacent = neighbour(at(7, 7), 0);
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "lightSpearman", hex: adjacent, facing: 3 },
    ]));

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "outOfRange",
    );
  });
});

describe("Ближний бой", () => {
  test("бьёт ×0,5 в любой соседний Гекс, не только во Фронт", () => {
    // target сидит СБОКУ от стрелка (не в его Фронте) — обычная Атака бы туда
    // не дотянулась, а Ближний бой дотягивается.
    const target = neighbour(at(7, 7), 2);
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "mediumInfantry", hex: target, facing: 3 },
    ]));

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "meleeShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage * 0.5,
    );
  });

  test("стрелок получает моральный самоурон", () => {
    const target = neighbour(at(7, 7), 0);
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
    ]));

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "meleeShot" });
    // Самоурон — ×1,5 от собственного немодифицированного Урона стрелка: 6×1.5=9.
    assert.equal(squadById(shot, "shooter")?.morale, SQUAD_TYPES.archer.morale - 9);
    assert.equal(squadById(shot, "shooter")?.health, SQUAD_TYPES.archer.health);
  });
});

describe("Боезапас", () => {
  test("каждый выстрел тратит единицу", () => {
    const target = at(9, 7);
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "heavySpearman", hex: target, facing: 3 },
    ]));

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.equal(squadById(shot, "shooter")?.ammo, 7);
  });

  test("исчерпав Боезапас, Отряд не стреляет", () => {
    const target = at(9, 7);
    let state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "heavySpearman", hex: target, facing: 3 },
    ]));

    for (let shots = 0; shots < 8; shots++) {
      state = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
      state = ok(state, { kind: "endTurn" });
    }
    assert.equal(squadById(state, "shooter")?.ammo, 0);

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "outOfAmmo",
    );
  });

  test("Отряд, дошедший до Обоза, восстанавливает Боезапас", () => {
    const near = at(7, 1); // рядом с северным краем
    const state = battle([{ id: "shooter", side: "blue", type: "archer", hex: near, facing: 4 }]);
    const depleted: BattleState = { ...state, squads: state.squads.map((s) => ({ ...s, ammo: 2 })) };

    const restocked = ok(depleted, { kind: "step", to: at(7, 0) });
    assert.equal(squadById(restocked, "shooter")?.ammo, 8);
    assert.ok(restocked.log.some((event) => event.kind === "ammoRestocked" && event.by === "baggage"));
  });
});

describe("Союзное снабжение", () => {
  const setup = (): BattleState => {
    const supplierHex = at(7, 7);
    const targetHex = neighbour(supplierHex, 0);
    return battle([
      { id: "supplier", side: "blue", type: "lightSpearman", hex: supplierHex, facing: 0 },
      { id: "target", side: "blue", type: "archer", hex: targetHex, facing: 3 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);
  };

  test("пополняет Боезапас союзного дальнобойного Отряда", () => {
    const state = setup();
    const depleted: BattleState = {
      ...state,
      squads: state.squads.map((s) => (s.id === "target" ? { ...s, ammo: 1 } : s)),
    };
    const resupplied = ok(untilActive(depleted, "supplier"), { kind: "resupply", target: "target" });

    assert.equal(squadById(resupplied, "target")?.ammo, 8);
  });

  test("не-лучник теряет свою Атаку в этом Ходу", () => {
    const state = setup();
    const resupplied = ok(untilActive(state, "supplier"), { kind: "resupply", target: "target" });

    assert.equal(squadById(resupplied, "supplier")?.spent.attacked, true);
  });

  test("лучник, снабжающий союзника, сохраняет свою Атаку", () => {
    const supplierHex = at(7, 7);
    const targetHex = neighbour(supplierHex, 0);
    const state = battle([
      { id: "supplier", side: "blue", type: "archer", hex: supplierHex, facing: 0 },
      { id: "target", side: "blue", type: "horseArcher", hex: targetHex, facing: 3 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);
    const resupplied = ok(untilActive(state, "supplier"), { kind: "resupply", target: "target" });

    assert.equal(squadById(resupplied, "supplier")?.spent.attacked, false);
  });

  test("не снабжает больше трёх Отрядов за Бой", () => {
    const supplierHex = at(7, 7);
    const state = battle([
      { id: "supplier", side: "blue", type: "lightSpearman", hex: supplierHex, facing: 0 },
      { id: "one", side: "blue", type: "archer", hex: neighbour(supplierHex, 0), facing: 3 },
      { id: "two", side: "blue", type: "archer", hex: neighbour(supplierHex, 1), facing: 3 },
      { id: "three", side: "blue", type: "archer", hex: neighbour(supplierHex, 2), facing: 3 },
      { id: "four", side: "blue", type: "archer", hex: neighbour(supplierHex, 3), facing: 3 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(1, 1), facing: 0 },
    ]);

    let current = untilActive(state, "supplier");
    for (const targetId of ["one", "two", "three"]) {
      current = ok(current, { kind: "resupply", target: targetId });
      current = ok(current, { kind: "endTurn" });
      current = untilActive(current, "supplier");
    }

    assert.equal(rejected(current, { kind: "resupply", target: "four" }), "cannotResupply");
  });
});

describe("Арбалетчик", () => {
  test("не стреляет Навесом", () => {
    const target = at(9, 7);
    const state = battle(
      [
        { id: "shooter", side: "blue", type: "crossbowman", hex: at(7, 7), facing: 0 },
        { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
        { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
      ],
    );

    assert.equal(
      rejected(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" }),
      "modeForbidden",
    );
  });

  test("бьёт Прямой наводкой на Гекс дальше обычного", () => {
    const target = at(10, 7); // 3 Гекса — обычным лучникам недоступно
    const state = battle([
      { id: "shooter", side: "blue", type: "crossbowman", hex: at(7, 7), facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
    ]);

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    // База 20 (см. каталог) × 2 = 40 — ровно число из статьи для Прямой наводки.
    assert.equal(squadById(shot, "target")?.health, SQUAD_TYPES.lightSpearman.health - 40);
  });

  test("атакует раз в два Хода", () => {
    const target = at(10, 7);
    const state = battle([
      { id: "shooter", side: "blue", type: "crossbowman", hex: at(7, 7), facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
    ]);

    const firstShot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    const nextTurn = untilActive(ok(firstShot, { kind: "endTurn" }), "shooter");
    assert.equal(
      rejected(nextTurn, { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "reloading",
    );

    const turnAfter = untilActive(ok(nextTurn, { kind: "endTurn" }), "shooter");
    const applied = apply(turnAfter, { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });
});

describe("Конный лучник", () => {
  test("бьёт Навесом на два Гекса", () => {
    const near = at(9, 7); // 2 Гекса
    const far = at(10, 7); // 3 Гекса — уже недоступно
    const state = battle([
      { id: "shooter", side: "blue", type: "horseArcher", hex: at(7, 7), facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      { id: "near", side: "red", type: "mediumInfantry", hex: near, facing: 3 },
      { id: "far", side: "red", type: "mediumInfantry", hex: far, facing: 3 },
    ]);

    const active = untilActive(state, "shooter");
    assert.equal(rejected(active, { kind: "rangedAttack", target: "far", mode: "arcShot" }), "outOfRange");
    const shot = ok(active, { kind: "rangedAttack", target: "near", mode: "arcShot" });
    assert.equal(squadById(shot, "near")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.horseArcher.damage);
  });

  test("Прямой наводкой бьёт только в соседний Гекс", () => {
    const adjacent = neighbour(at(7, 7), 0);
    const state = battle([
      { id: "shooter", side: "blue", type: "horseArcher", hex: at(7, 7), facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      { id: "target", side: "red", type: "mediumInfantry", hex: adjacent, facing: 3 },
    ]);

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.horseArcher.damage * 2,
    );
  });

  test("достаёт свои Фланг и Тыл, не только Фронт", () => {
    // shooter смотрит на восток (facing0) — цель у него точно в Тылу (запад).
    const rear = neighbour(at(7, 7), 3);
    const state = battle([
      { id: "shooter", side: "blue", type: "horseArcher", hex: at(7, 7), facing: 0 },
      { id: "anchor", side: "blue", type: "heavySpearman", hex: at(1, 1), facing: 0 },
      { id: "target", side: "red", type: "mediumInfantry", hex: rear, facing: 3 },
    ]);

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.horseArcher.damage * 2,
    );
  });
});

describe("Оппортун дальнего боя", () => {
  test("Зона провокации дальнобойного Отряда совпадает с конусом Навеса", () => {
    const sentryHex = at(7, 7);
    // Гекс в трёх Гексах от лучника — вне Фронта обычной Атаки, но внутри конуса.
    const entry = at(4, 7);
    const provokerStart = neighbour(entry, 3);
    const state = battle([
      { id: "sentry", side: "red", type: "archer", hex: sentryHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: provokerStart, facing: 0 },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    assert.deepEqual(armed.armedThreats, [{ holder: "sentry", against: "prov" }]);
  });

  test("Оппортун стрелка расходует выстрел и весь его Ход", () => {
    const sentryHex = at(7, 7);
    const entry = neighbour(sentryHex, 3);
    const provokerStart = neighbour(entry, 3);
    const state = battle([
      { id: "sentry", side: "red", type: "archer", hex: sentryHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightSpearman", hex: provokerStart, facing: 0 },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    const opportunity = ok(armed, { kind: "rotate", facing: 3 });
    const struck = ok(opportunity, { kind: "opportunity", strike: true });

    assert.equal(squadById(struck, "sentry")?.ammo, 7);
    assert.equal(squadById(struck, "sentry")?.spent.attacked, true);
  });

  test("лёгкая кавалерия не может быть целью Оппортуна дальнего боя", () => {
    const sentryHex = at(7, 7);
    const entry = neighbour(sentryHex, 3);
    const provokerStart = neighbour(entry, 3);
    const state = battle([
      { id: "sentry", side: "red", type: "archer", hex: sentryHex, facing: 3 },
      { id: "prov", side: "blue", type: "lightCavalry", hex: provokerStart, facing: 0 },
    ]);

    const armed = ok(untilActive(state, "prov"), { kind: "step", to: entry });
    assert.deepEqual(armed.armedThreats, []);
  });
});

describe("Местность и дальний бой", () => {
  test("лес режет входящий урон ×0,5", () => {
    const target = at(9, 7);
    const key = `${target.col},${target.row}`;
    const state = battle(
      anchoredArcher("archer", [{ id: "target", side: "red", type: "mediumInfantry", hex: target, facing: 3 }]),
      { [key]: "forest" },
    );

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - Math.round(SQUAD_TYPES.archer.damage * 0.5),
    );
  });

  test("заросли режут входящий урон ×0,75", () => {
    const target = at(9, 7);
    const key = `${target.col},${target.row}`;
    const state = battle(
      anchoredArcher("archer", [{ id: "target", side: "red", type: "mediumInfantry", hex: target, facing: 3 }]),
      { [key]: "thicket" },
    );

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - Math.round(SQUAD_TYPES.archer.damage * 0.75),
    );
  });
});

describe("Дальняя атака заменяет обычную", () => {
  test("дальнобойный Отряд не может пользоваться обычной Атакой", () => {
    const target = neighbour(at(7, 7), 0);
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
    ]));

    assert.equal(rejected(untilActive(state, "shooter"), { kind: "attack", target: "target" }), "requiresRangedAttack");
  });

  test("legalIntents перечисляет доступные режимы Дальней атаки", () => {
    const target = at(9, 7);
    const state = battle(anchoredArcher("archer", [
      { id: "target", side: "red", type: "lightSpearman", hex: target, facing: 3 },
    ]));

    const intents = legalIntents(untilActive(state, "shooter"));
    const modes = intents
      .filter((intent): intent is Extract<Intent, { kind: "rangedAttack" }> => intent.kind === "rangedAttack")
      .map((intent) => intent.mode);

    assert.ok(modes.includes("arcShot"));
    assert.ok(modes.includes("directShot"));
  });
});
