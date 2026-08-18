import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, legalIntents, squadById, SQUAD_TYPES } from "./index.ts";
import { facingTowards, neighbour, sides } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const battle = (squads: readonly SquadSetup[]): BattleState =>
  start({ board: { width: 16, height: 16 }, squads }, {}, 1);

const raw = (state: BattleState, intent: Intent): BattleState => {
  const applied = apply(state, intent);
  assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

/**
 * Разрешает встречные прерывания отказом: подход кавалерии к строю неизбежно
 * взводит Оппортуны, а этот файл не про них — интересен сам Удар, который
 * после отказа держателей и исполняется.
 */
const settleInterrupts = (state: BattleState): BattleState => {
  let current = state;
  for (let guard = 0; guard < 24; guard++) {
    if (current.phase.kind === "opportunity") {
      current = raw(current, { kind: "opportunity", strike: false });
      continue;
    }
    if (current.phase.kind === "breakthrough") {
      current = raw(current, { kind: "breakthrough", push: false });
      continue;
    }
    return current;
  }
  throw new Error("прерывания не заканчиваются");
};

const ok = (state: BattleState, intent: Intent): BattleState => settleInterrupts(raw(state, intent));

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

/** Уводит копейщика вбок, не меняя Направления — освобождает Гекс, оставляя
 *  на нём то, что там лежит. */
const stepAside = (state: BattleState, squad: string): BattleState => {
  const mover = squadById(state, squad);
  if (mover === undefined) throw new Error(`Отряд ${squad} исчез`);
  const aside = sides(mover.hex, mover.facing).flank[0]!;
  return ok(state, { kind: "step", to: aside });
};

/** Гонит Отряд прямо вперёд заданное число Гексов. */
const advance = (state: BattleState, squad: string, steps: number): BattleState => {
  let current = state;
  for (let step = 0; step < steps; step++) {
    const mover = squadById(current, squad);
    if (mover === undefined) throw new Error(`Отряд ${squad} исчез`);
    const ahead = sides(mover.hex, mover.facing).front[0]!;
    current = ok(current, { kind: "step", to: ahead });
  }
  return current;
};

/**
 * Полоса разгона: кавалерия на западе, цель на востоке ровно так, чтобы после
 * `steps` шагов вперёд она оказалась с целью вплотную. `steps` — это и есть
 * разбег, с которым кавалерия придёт в контакт.
 */
const chargeLane = (
  cavalryType: SquadSetup["type"],
  targetType: SquadSetup["type"],
  steps: number,
  extra: readonly SquadSetup[] = [],
): { state: BattleState; targetHex: Hex } => {
  const start = at(3, 7);
  let targetHex = start;
  for (let step = 0; step <= steps; step++) targetHex = neighbour(targetHex, 0);

  return {
    state: battle([
      { id: "horse", side: "blue", type: cavalryType, hex: start, facing: 0 },
      { id: "target", side: "red", type: targetType, hex: targetHex, facing: 3 },
      ...extra,
    ]),
    targetHex,
  };
};

describe("Таранный удар: накопление разгона", () => {
  test("каждый шаг вперёд подряд добавляет процент Типа", () => {
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 2);
    const charged = advance(untilActive(state, "horse"), "horse", 2);
    assert.equal(squadById(charged, "horse")?.chargeSteps, 2);

    const after = ok(charged, { kind: "attack", target: "target" });
    // Тяжёлая кавалерия: 24% за Гекс × 2 = 48% → ×1,48 от Урона 25 = 37.
    assert.equal(squadById(after, "target")?.health, SQUAD_TYPES.mediumInfantry.health - 37);
  });

  test("итоговый множитель — единица плюс накопленный процент", () => {
    // Лёгкая кавалерия: 8% × 3 = 24% → ×1,24 от Урона 10 = 12,4 → 12.
    const { state } = chargeLane("lightCavalry", "mediumInfantry", 3);
    const charged = advance(untilActive(state, "horse"), "horse", 3);
    const after = ok(charged, { kind: "attack", target: "target" });

    assert.equal(squadById(after, "target")?.health, SQUAD_TYPES.mediumInfantry.health - 12);
  });

  test("любой разворот обнуляет разгон", () => {
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 2);
    const charged = advance(untilActive(state, "horse"), "horse", 2);
    assert.equal(squadById(charged, "horse")?.chargeSteps, 2);

    // Развернуться и обратно — разгон потерян, хотя Гексы пройдены.
    const turned = ok(charged, { kind: "rotate", facing: 1 });
    assert.equal(squadById(turned, "horse")?.chargeSteps, 0);
  });

  test("разгон действует один Ход и сгорает", () => {
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 4);
    const charged = advance(untilActive(state, "horse"), "horse", 2);
    assert.equal(squadById(charged, "horse")?.chargeSteps, 2);

    const nextTurn = untilActive(ok(charged, { kind: "endTurn" }), "horse");
    assert.equal(squadById(nextTurn, "horse")?.chargeSteps, 0);
  });

  test("без разгона Урон обычный", () => {
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 0);
    const after = ok(untilActive(state, "horse"), { kind: "attack", target: "target" });

    assert.equal(squadById(after, "target")?.health, SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.heavyCavalry.damage);
  });
});

describe("Таранный удар: моральный урон", () => {
  test("разбег от трёх Гексов добавляет ×1,25 морального урона", () => {
    const { state } = chargeLane("lightCavalry", "mediumInfantry", 3);
    const charged = advance(untilActive(state, "horse"), "horse", 3);
    const after = ok(charged, { kind: "attack", target: "target" });

    // Урон 10 × 1,24 (разгон) = 12,4; по Морали ещё ×1,25 → 15,5 → 16.
    assert.equal(squadById(after, "target")?.morale, SQUAD_TYPES.mediumInfantry.morale - 16);
  });

  test("разбег в два Гекса моральной добавки не даёт", () => {
    const { state } = chargeLane("lightCavalry", "mediumInfantry", 2);
    const charged = advance(untilActive(state, "horse"), "horse", 2);
    const after = ok(charged, { kind: "attack", target: "target" });

    // 10 × 1,16 = 11,6 → 12 и по Здоровью, и по Морали: добавки нет.
    assert.equal(squadById(after, "target")?.health, SQUAD_TYPES.mediumInfantry.health - 12);
    assert.equal(squadById(after, "target")?.morale, SQUAD_TYPES.mediumInfantry.morale - 12);
  });

  test("моральный урон кавалерии не режется Предельным уроном", () => {
    // Разбег в 9 Гексов: 24% × 9 = 216% → ×3,16. Урон 25 даёт 79 сырых — выше
    // потолка ×3 = 75.
    //
    // Такой разбег ставится в состояние напрямую, а не набегается: у тяжёлой
    // кавалерии Скорость 3, и даже с Ускорением она проходит за Ход шесть
    // Гексов. Потолок ×3 разгоном в принципе недостижим — его пробивают только
    // вместе с множителями Местности (тикет 10). Проверяется здесь именно
    // правило урона, а не Запас хода.
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 0);
    const ready = untilActive(state, "horse");
    const charged: BattleState = {
      ...ready,
      squads: ready.squads.map((squad) => (squad.id === "horse" ? { ...squad, chargeSteps: 9 } : squad)),
    };
    const after = ok(charged, { kind: "attack", target: "target" });

    const struck = after.log.find((event) => event.kind === "attacked" && !event.counterattack);
    assert.ok(struck !== undefined && struck.kind === "attacked");
    if (struck.kind !== "attacked") throw new Error("unreachable");

    // Здоровье срезано потолком: 3 × 25 = 75, а не 79.
    assert.equal(struck.health, SQUAD_TYPES.heavyCavalry.damage * 3);
    // Мораль потолка не знает: 79 × 1,25 = 98,75 → 99.
    assert.equal(struck.morale, 99);
  });

  test("цель, сломленная моральным уроном разбега, не контратакует", () => {
    // Копейщик урезан до 20 солдат: Мораль 14, Здоровье 16. Разогнавшаяся
    // кавалерия ломает Мораль раньше, чем физический урон успевает убить.
    const { state } = chargeLane("lightCavalry", "lightSpearman", 3, []);
    const shrunk: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "target" ? { ...squad, headcount: 20, health: 16, morale: 14 } : squad)),
    };
    const charged = advance(untilActive(shrunk, "horse"), "horse", 3);
    const before = squadById(charged, "horse")?.health ?? 0;
    const after = ok(charged, { kind: "attack", target: "target" });

    assert.equal(squadById(after, "target")?.routing, true);
    // Кавалерия не получила ответного урона.
    assert.equal(squadById(after, "horse")?.health, before);
  });
});

describe("Маневренность", () => {
  test("кавалерия перемещается после атаки в том же Ходу", () => {
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 0);
    const attacked = ok(untilActive(state, "horse"), { kind: "attack", target: "target" });

    const mover = squadById(attacked, "horse")!;
    const applied = apply(attacked, { kind: "rotate", facing: ((mover.facing + 1) % 6) as 0 | 1 | 2 | 3 | 4 | 5 });
    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });

  test("но второй Атаки Маневренность не даёт", () => {
    const { state } = chargeLane("heavyCavalry", "mediumInfantry", 0);
    const attacked = ok(untilActive(state, "horse"), { kind: "attack", target: "target" });

    assert.equal(rejected(attacked, { kind: "attack", target: "target" }), "alreadyAttacked");
  });

  test("пехота после атаки не двигается", () => {
    const targetHex = at(7, 7);
    const attackerHex = sides(targetHex, 0).front[0]!;
    const state = battle([
      { id: "foot", side: "blue", type: "mediumSpearman", hex: attackerHex, facing: 3 },
      { id: "target", side: "red", type: "mediumInfantry", hex: targetHex, facing: 0 },
    ]);
    const attacked = ok(untilActive(state, "foot"), { kind: "attack", target: "target" });

    assert.equal(rejected(attacked, { kind: "rotate", facing: 1 }), "alreadyAttacked");
  });
});

describe("Отражение Сомкнутого строя", () => {
  /** Копейщик со стеной щитов встречает разогнавшуюся кавалерию. */
  const wallVsCharge = (): { state: BattleState; wallHex: Hex } => {
    const start = at(3, 7);
    const wallHex = neighbour(neighbour(neighbour(start, 0), 0), 0);
    const flankHex = sides(wallHex, 3).flank[0]!;
    return {
      state: battle([
        { id: "horse", side: "blue", type: "heavyCavalry", hex: start, facing: 0 },
        { id: "wall", side: "red", type: "heavySpearman", hex: wallHex, facing: 3 },
        { id: "prop", side: "red", type: "heavySpearman", hex: flankHex, facing: 3 },
      ]),
      wallHex,
    };
  };

  test("копейщик в строю возвращает атакующему урон разбега", () => {
    const { state } = wallVsCharge();
    const charged = advance(untilActive(state, "horse"), "horse", 2);
    const horseHealthBefore = squadById(charged, "horse")?.health ?? 0;

    const after = ok(charged, { kind: "attack", target: "wall" });
    const dealt = SQUAD_TYPES.heavySpearman.health - (squadById(after, "wall")?.health ?? 0);

    assert.ok(dealt > 0, "кавалерия что-то нанесла");
    assert.ok(after.log.some((event) => event.kind === "chargeReflected" && event.health === dealt));
    // Кавалерия получила ровно столько же обратно, плюс обычную Контратаку.
    assert.ok((squadById(after, "horse")?.health ?? 0) <= horseHealthBefore - dealt);
  });

  test("без разгона Отражения нет", () => {
    const { state, wallHex } = wallVsCharge();
    // Ставим кавалерию вплотную, чтобы она ударила без единого шага.
    const adjacent = neighbour(wallHex, 3);
    const placed: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "horse" ? { ...squad, hex: adjacent } : squad)),
    };

    const after = ok(untilActive(placed, "horse"), { kind: "attack", target: "wall" });
    assert.ok(!after.log.some((event) => event.kind === "chargeReflected"));
  });

  test("копейщик без строя не отражает", () => {
    const start = at(3, 7);
    const wallHex = neighbour(neighbour(neighbour(start, 0), 0), 0);
    const state = battle([
      { id: "horse", side: "blue", type: "heavyCavalry", hex: start, facing: 0 },
      { id: "wall", side: "red", type: "heavySpearman", hex: wallHex, facing: 3 },
      { id: "anchor", side: "red", type: "heavySpearman", hex: at(14, 14), facing: 0 },
    ]);
    const charged = advance(untilActive(state, "horse"), "horse", 2);
    const after = ok(charged, { kind: "attack", target: "wall" });

    assert.ok(!after.log.some((event) => event.kind === "chargeReflected"));
  });

  test("Отражение работает и у Отряда в Бегстве", () => {
    const { state } = wallVsCharge();
    const broken: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "wall" ? { ...squad, routing: true } : squad)),
    };
    const charged = advance(untilActive(broken, "horse"), "horse", 2);
    const after = ok(charged, { kind: "attack", target: "wall" });

    assert.ok(after.log.some((event) => event.kind === "chargeReflected"));
  });
});

describe("Спешивание и Седлание", () => {
  const mountedPair = (): BattleState =>
    battle([
      { id: "horse", side: "blue", type: "heavyCavalry", hex: at(7, 7), facing: 0 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(14, 14), facing: 0 },
    ]);

  test("Спешивание превращает кавалерию в аналогичную пехоту и оставляет коней", () => {
    const state = untilActive(mountedPair(), "horse");
    const dismounted = ok(state, { kind: "dismount" });

    const squad = squadById(dismounted, "horse");
    assert.equal(squad?.type, "heavySpearman");
    assert.deepEqual(dismounted.horses, [{ hex: at(7, 7), side: "blue", mountsTo: "heavyCavalry" }]);
    assert.ok(dismounted.log.some((event) => event.kind === "dismounted"));
  });

  test("Здоровье конвертируется через проценты, а не переносится числом", () => {
    const state = untilActive(mountedPair(), "horse");
    // Ранят кавалерию ровно вполовину: 120 → 60.
    const wounded: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "horse" ? { ...squad, health: 60 } : squad)),
    };
    const dismounted = ok(wounded, { kind: "dismount" });

    // Половина от Здоровья тяжёлого копейщика (160), а не перенесённые 60.
    assert.equal(squadById(dismounted, "horse")?.health, 80);
  });

  test("Спешивание стоит единицу Запаса хода", () => {
    const state = untilActive(mountedPair(), "horse");
    const before = squadById(state, "horse")?.movement ?? 0;
    const dismounted = ok(state, { kind: "dismount" });

    assert.equal(squadById(dismounted, "horse")?.movement, before - 1);
  });

  test("пехота, не имеющая коней на Гексе, Седлать не может", () => {
    const state = battle([
      { id: "foot", side: "blue", type: "heavySpearman", hex: at(7, 7), facing: 0 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(14, 14), facing: 0 },
    ]);

    assert.equal(rejected(untilActive(state, "foot"), { kind: "mount" }), "noHorses");
  });

  test("Отряд, оседлавший коней, становится кавалерией с Рангом I", () => {
    const state = untilActive(mountedPair(), "horse");
    const ranked: BattleState = {
      ...state,
      squads: state.squads.map((squad) => (squad.id === "horse" ? { ...squad, rank: 4 } : squad)),
    };
    const dismounted = ok(ranked, { kind: "dismount" });
    assert.equal(squadById(dismounted, "horse")?.rank, 4, "Спешивание Ранг не трогает");

    const remounted = ok(untilActive(ok(dismounted, { kind: "endTurn" }), "horse"), { kind: "mount" });
    assert.equal(squadById(remounted, "horse")?.type, "heavyCavalry");
    assert.equal(squadById(remounted, "horse")?.rank, 1);
    assert.deepEqual(remounted.horses, []);
  });

  test("пехота не своего Типа чужих коней не седлает", () => {
    const state = untilActive(mountedPair(), "horse");
    const dismounted = ok(state, { kind: "dismount" });
    // Подменяем спешенный Отряд на лёгкого копейщика: его кони — lightCavalry,
    // а на Гексе лежат тяжёлые.
    const mismatched: BattleState = {
      ...dismounted,
      squads: dismounted.squads.map((squad) => (squad.id === "horse" ? { ...squad, type: "lightSpearman" as const } : squad)),
    };
    const turn = untilActive(ok(mismatched, { kind: "endTurn" }), "horse");

    assert.equal(rejected(turn, { kind: "mount" }), "cannotDismount");
  });

  test("не-кавалерия Спешиться не может", () => {
    const state = battle([
      { id: "foot", side: "blue", type: "heavySpearman", hex: at(7, 7), facing: 0 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(14, 14), facing: 0 },
    ]);

    assert.equal(rejected(untilActive(state, "foot"), { kind: "dismount" }), "cannotDismount");
  });

  test("конный лучник спешивается в обычного лучника", () => {
    const state = battle([
      { id: "rider", side: "blue", type: "horseArcher", hex: at(7, 7), facing: 0 },
      { id: "foe", side: "red", type: "heavySpearman", hex: at(14, 14), facing: 0 },
    ]);
    const dismounted = ok(untilActive(state, "rider"), { kind: "dismount" });

    assert.equal(squadById(dismounted, "rider")?.type, "archer");
    assert.equal(dismounted.horses[0]?.mountsTo, "horseArcher");
  });

  test("legalIntents предлагает Спешивание кавалерии и Седлание над конями", () => {
    const state = untilActive(mountedPair(), "horse");
    assert.ok(legalIntents(state).some((intent) => intent.kind === "dismount"));

    const dismounted = ok(state, { kind: "dismount" });
    const turn = untilActive(ok(dismounted, { kind: "endTurn" }), "horse");
    assert.ok(legalIntents(turn).some((intent) => intent.kind === "mount"));
  });
});

describe("Кони разбегаются", () => {
  test("от боя на их Гексе", () => {
    // Кавалерия спешивается, потом по ней бьёт враг — кони на том же Гексе.
    const footHex = at(7, 7);
    const foeHex = neighbour(footHex, 0);
    const state = battle([
      { id: "horse", side: "blue", type: "heavyCavalry", hex: footHex, facing: 0 },
      { id: "foe", side: "red", type: "heavyInfantry", hex: foeHex, facing: facingTowards(foeHex, footHex)! },
    ]);

    const dismounted = ok(untilActive(state, "horse"), { kind: "dismount" });
    assert.equal(dismounted.horses.length, 1);

    const attacked = ok(untilActive(dismounted, "foe"), { kind: "attack", target: "horse" });
    assert.deepEqual(attacked.horses, []);
    assert.ok(attacked.log.some((event) => event.kind === "horsesFled"));
  });

  test("от Прямой наводки, проходящей через их Гекс", () => {
    // Стрелок — цель — а кони лежат ровно между ними.
    const shooterHex = at(4, 7);
    const middleHex = neighbour(shooterHex, 0);
    const targetHex = neighbour(middleHex, 0);
    const state = battle([
      { id: "shooter", side: "red", type: "archer", hex: shooterHex, facing: 0 },
      { id: "rider", side: "blue", type: "heavyCavalry", hex: middleHex, facing: 0 },
      { id: "target", side: "blue", type: "mediumInfantry", hex: targetHex, facing: 3 },
    ]);

    // Кавалерия спешивается, оставляя коней на среднем Гексе, и сходит с линии
    // вбок — тогда линия огня свободна, а кони остаются лежать на ней.
    const dismounted = ok(untilActive(state, "rider"), { kind: "dismount" });
    assert.equal(dismounted.horses.length, 1);
    const cleared = stepAside(dismounted, "rider");

    const shot = ok(untilActive(cleared, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    assert.deepEqual(shot.horses, []);
    assert.ok(shot.log.some((event) => event.kind === "horsesFled"));
  });

  test("Навес коней не пугает — он летит поверх", () => {
    const shooterHex = at(4, 7);
    const middleHex = neighbour(shooterHex, 0);
    const targetHex = neighbour(neighbour(middleHex, 0), 0);
    const state = battle([
      { id: "shooter", side: "red", type: "archer", hex: shooterHex, facing: 0 },
      { id: "rider", side: "blue", type: "heavyCavalry", hex: middleHex, facing: 0 },
      { id: "target", side: "blue", type: "mediumInfantry", hex: targetHex, facing: 3 },
    ]);

    const dismounted = ok(untilActive(state, "rider"), { kind: "dismount" });
    const cleared = stepAside(dismounted, "rider");

    const shot = ok(untilActive(cleared, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(shot.horses.length, 1);
  });
});
