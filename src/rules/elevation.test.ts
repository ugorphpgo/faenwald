import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { start, apply, squadById, SQUAD_TYPES } from "./index.ts";
import { elevationFactor } from "./elevation.ts";
import { facingTowards, neighbour, sides } from "./hex.ts";
import type { BattleState, Hex, Intent, SquadSetup } from "./index.ts";
import type { TerrainId } from "./catalog/terrain.ts";

const at = (col: number, row: number): Hex => ({ col, row });
const key = (hex: Hex): string => `${hex.col},${hex.row}`;

const battle = (
  squads: readonly SquadSetup[],
  terrain: Readonly<Record<string, TerrainId>> = {},
): BattleState => start({ board: { width: 16, height: 16, terrain }, squads }, {}, 1);

const raw = (state: BattleState, intent: Intent): BattleState => {
  const applied = apply(state, intent);
  assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  if (!applied.ok) throw new Error("unreachable");
  return applied.state;
};

/** Отказывается от встречных прерываний — этот файл про высоту, не про них. */
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

/**
 * Дуэль на разной высоте: атакующий в (7,7), защитник на соседнем Гексе,
 * оба смотрят друг на друга. Оба Отряда — средние копейщики, чтобы числа
 * ни за что не зацепились, кроме высоты.
 */
const heightDuel = (
  attackerTerrain: TerrainId,
  defenderTerrain: TerrainId,
  attackerType: SquadSetup["type"] = "mediumSpearman",
): BattleState => {
  const attackerHex = at(7, 7);
  const defenderHex = neighbour(attackerHex, 0);
  return battle(
    [
      { id: "attacker", side: "blue", type: attackerType, hex: attackerHex, facing: 0 },
      { id: "defender", side: "red", type: "mediumSpearman", hex: defenderHex, facing: 3 },
    ],
    { [key(attackerHex)]: attackerTerrain, [key(defenderHex)]: defenderTerrain },
  );
};

const dealtTo = (state: BattleState, defender: string, baseHealth: number): number =>
  baseHealth - (squadById(state, defender)?.health ?? 0);

describe("Уровни: множитель разницы высот", () => {
  test("ступень вверх даёт ×1,25, ступень вниз ×0,75", () => {
    assert.equal(elevationFactor(1, 0), 1.25);
    assert.equal(elevationFactor(0, 1), 0.75);
    assert.equal(elevationFactor(2, 1), 1.25);
    assert.equal(elevationFactor(1, 2), 0.75);
  });

  test("две ступени дают ×1,5 и ×0,5", () => {
    assert.equal(elevationFactor(2, 0), 1.5);
    assert.equal(elevationFactor(0, 2), 0.5);
  });

  test("на равных высотах множителя нет", () => {
    assert.equal(elevationFactor(0, 0), 1);
    assert.equal(elevationFactor(2, 2), 1);
  });
});

describe("Уровни в бою", () => {
  const damage = SQUAD_TYPES.mediumSpearman.damage;
  const health = SQUAD_TYPES.mediumSpearman.health;

  test("с предхолмья по равнине — ×1,25", () => {
    const state = heightDuel("foothill", "plain");
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });
    assert.equal(dealtTo(after, "defender", health), Math.round(damage * 1.25));
  });

  test("с равнины по предхолмью — ×0,75", () => {
    const state = heightDuel("plain", "foothill");
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });
    assert.equal(dealtTo(after, "defender", health), Math.round(damage * 0.75));
  });

  test("с предхолмья по холму — ×0,75", () => {
    const state = heightDuel("foothill", "hill");
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });
    assert.equal(dealtTo(after, "defender", health), Math.round(damage * 0.75));
  });

  test("с холма по предхолмью — ×1,25", () => {
    const state = heightDuel("hill", "foothill");
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });
    assert.equal(dealtTo(after, "defender", health), Math.round(damage * 1.25));
  });

  test("с холма по равнине — ×1,5", () => {
    const state = heightDuel("hill", "plain");
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });
    assert.equal(dealtTo(after, "defender", health), Math.round(damage * 1.5));
  });

  test("с равнины по холму — ×0,5", () => {
    const state = heightDuel("plain", "hill");
    const after = ok(untilActive(state, "attacker"), { kind: "attack", target: "defender" });
    assert.equal(dealtTo(after, "defender", health), Math.round(damage * 0.5));
  });
});

describe("Уровни в перемещении", () => {
  const climb = (fromTerrain: TerrainId, toTerrain: TerrainId): number => {
    const fromHex = at(7, 7);
    const toHex = neighbour(fromHex, 0);
    const state = battle(
      [
        { id: "mover", side: "blue", type: "lightSpearman", hex: fromHex, facing: 0 },
        { id: "foe", side: "red", type: "heavySpearman", hex: at(14, 14), facing: 0 },
      ],
      { [key(fromHex)]: fromTerrain, [key(toHex)]: toTerrain },
    );
    const before = squadById(state, "mover")?.movement ?? 0;
    const after = ok(untilActive(state, "mover"), { kind: "step", to: toHex });
    return before - (squadById(after, "mover")?.movement ?? 0);
  };

  test("подъём с равнины на предхолмье стоит вдвое", () => {
    assert.equal(climb("plain", "foothill"), 2);
  });

  test("подъём с предхолмья на холм стоит вдвое", () => {
    assert.equal(climb("foothill", "hill"), 2);
  });

  test("движение по одному уровню обычное", () => {
    assert.equal(climb("hill", "hill"), 1);
    assert.equal(climb("foothill", "foothill"), 1);
  });

  test("спуск обычный", () => {
    assert.equal(climb("hill", "foothill"), 1);
    assert.equal(climb("hill", "plain"), 1);
  });
});

describe("Уровни и дальний бой", () => {
  test("лучник на предхолмье стреляет Навесом на Гекс дальше", () => {
    const shooterHex = at(4, 7);
    // Пятый Гекс на восток — обычному лучнику (глубина 4) недоступен.
    let farHex = shooterHex;
    for (let step = 0; step < 5; step++) farHex = neighbour(farHex, 0);

    const onPlain = battle([
      { id: "shooter", side: "blue", type: "archer", hex: shooterHex, facing: 0 },
      { id: "target", side: "red", type: "mediumInfantry", hex: farHex, facing: 3 },
    ]);
    assert.equal(
      rejected(untilActive(onPlain, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" }),
      "outOfRange",
    );

    const onFoothill = battle(
      [
        { id: "shooter", side: "blue", type: "archer", hex: shooterHex, facing: 0 },
        { id: "target", side: "red", type: "mediumInfantry", hex: farHex, facing: 3 },
      ],
      { [key(shooterHex)]: "foothill" },
    );
    const shot = ok(untilActive(onFoothill, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage,
    );
  });

  test("лучник на холме стреляет на два Гекса дальше", () => {
    const shooterHex = at(4, 7);
    let farHex = shooterHex;
    for (let step = 0; step < 6; step++) farHex = neighbour(farHex, 0);

    const state = battle(
      [
        { id: "shooter", side: "blue", type: "archer", hex: shooterHex, facing: 0 },
        { id: "target", side: "red", type: "mediumInfantry", hex: farHex, facing: 3 },
      ],
      { [key(shooterHex)]: "hill" },
    );

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "arcShot" });
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage,
    );
  });

  test("лучник на высоте не получает её бонусов к Урону", () => {
    const shooterHex = at(4, 7);
    const targetHex = neighbour(neighbour(shooterHex, 0), 0);
    const state = battle(
      [
        { id: "shooter", side: "blue", type: "archer", hex: shooterHex, facing: 0 },
        { id: "target", side: "red", type: "mediumInfantry", hex: targetHex, facing: 3 },
      ],
      { [key(shooterHex)]: "hill" },
    );

    const shot = ok(untilActive(state, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" });
    // Прямая наводка ×2 и больше ничего: холм Урона не добавил.
    assert.equal(
      squadById(shot, "target")?.health,
      SQUAD_TYPES.mediumInfantry.health - SQUAD_TYPES.archer.damage * 2,
    );
  });

  test("Прямая наводка проходит сквозь Отряд уровнем ниже", () => {
    const shooterHex = at(4, 7);
    const betweenHex = neighbour(shooterHex, 0);
    const targetHex = neighbour(betweenHex, 0);

    const flat = battle([
      { id: "shooter", side: "blue", type: "archer", hex: shooterHex, facing: 0 },
      { id: "screen", side: "red", type: "mediumInfantry", hex: betweenHex, facing: 3 },
      { id: "target", side: "red", type: "mediumInfantry", hex: targetHex, facing: 3 },
    ]);
    assert.equal(
      rejected(untilActive(flat, "shooter"), { kind: "rangedAttack", target: "target", mode: "directShot" }),
      "lineBlocked",
    );

    // Тот же расклад, но стрелок на холме, а заслон внизу — выстрел проходит.
    const fromAbove = battle(
      [
        { id: "shooter", side: "blue", type: "archer", hex: shooterHex, facing: 0 },
        { id: "screen", side: "red", type: "mediumInfantry", hex: betweenHex, facing: 3 },
        { id: "target", side: "red", type: "mediumInfantry", hex: targetHex, facing: 3 },
      ],
      { [key(shooterHex)]: "hill" },
    );
    const applied = apply(untilActive(fromAbove, "shooter"), {
      kind: "rangedAttack",
      target: "target",
      mode: "directShot",
    });
    assert.ok(applied.ok, `отклонено: ${applied.ok ? "" : applied.reason.kind}`);
  });
});

describe("Контрольный пример статьи", () => {
  /**
   * Раздел 1.6 статьи: тяжёлые копейщики в Сомкнутом строю на холме против
   * тяжёлой кавалерии в разбеге на предхолмье.
   *
   * ⚠️ Пример внутри статьи несогласован: в тексте модификатор разбега назван
   * ×1,48, а в подставленной формуле — 1,5 (вопрос 4 в voprosy-avtoru.md). Здесь
   * это ни на что не влияет: 8,325 и 8,4375 округляются в одну и ту же восьмёрку.
   * Если автор ответит, что верно 1,5, тест устоит; падение здесь означало бы
   * изменение чего-то другого.
   */
  const example = (): BattleState => {
    // Кавалерия разгоняется по предхолмью и упирается в копейщиков на холме.
    const wallHex = at(9, 7);
    const cavalryStart = at(6, 7);
    const propHex = sides(wallHex, 3).flank[0]!;
    const propHex2 = sides(wallHex, 3).flank[1]!;

    const terrain: Record<string, TerrainId> = {
      [key(wallHex)]: "hill",
      [key(propHex)]: "hill",
      [key(propHex2)]: "hill",
    };
    let lane = cavalryStart;
    for (let step = 0; step < 3; step++) {
      terrain[key(lane)] = "foothill";
      lane = neighbour(lane, 0);
    }

    return battle(
      [
        { id: "horse", side: "blue", type: "heavyCavalry", hex: cavalryStart, facing: 0 },
        { id: "wall", side: "red", type: "heavySpearman", hex: wallHex, facing: 3 },
        { id: "prop", side: "red", type: "heavySpearman", hex: propHex, facing: 3 },
        { id: "prop2", side: "red", type: "heavySpearman", hex: propHex2, facing: 3 },
      ],
      terrain,
    );
  };

  test("кавалерия в разбеге наносит копейщикам 8 и получает столько же Отражением", () => {
    let state = untilActive(example(), "horse");
    // Два шага по предхолмью: разбег 2 Гекса, как в примере.
    for (let step = 0; step < 2; step++) {
      const mover = squadById(state, "horse")!;
      state = ok(state, { kind: "step", to: sides(mover.hex, mover.facing).front[0]! });
    }
    assert.equal(squadById(state, "horse")?.chargeSteps, 2);

    const healthBefore = squadById(state, "horse")?.health ?? 0;
    const after = ok(state, { kind: "attack", target: "wall" });

    // 25 × 0,75 (предхолмье против холма) × 1,48 (разбег) × 0,5 (стойкость
    // тяжёлых копейщиков к разбегу) × 0,6 (строй с двух сторон) = 8,325 → 8.
    const dealt = SQUAD_TYPES.heavySpearman.health - (squadById(after, "wall")?.health ?? 0);
    assert.equal(dealt, 8);

    // «Урон дополнительно отражается в кавалерию».
    const reflected = after.log.find((event) => event.kind === "chargeReflected");
    assert.ok(reflected !== undefined && reflected.kind === "chargeReflected");
    if (reflected.kind !== "chargeReflected") throw new Error("unreachable");
    assert.equal(reflected.health, 8);
    assert.ok((squadById(after, "horse")?.health ?? 0) <= healthBefore - 8);
  });

  test("копейщики с холма наносят кавалерии 23", () => {
    let state = untilActive(example(), "horse");
    for (let step = 0; step < 2; step++) {
      const mover = squadById(state, "horse")!;
      state = ok(state, { kind: "step", to: sides(mover.hex, mover.facing).front[0]! });
    }
    // Кавалерия встала вплотную и отходила; теперь бьют копейщики.
    state = ok(state, { kind: "endTurn" });
    const wallsTurn = untilActive(state, "wall");

    const horseHealthBefore = squadById(wallsTurn, "horse")?.health ?? 0;
    const after = ok(wallsTurn, { kind: "attack", target: "horse" });

    // 18 × 1,25 (холм против предхолмья) = 22,5 → 23.
    const dealt = horseHealthBefore - (squadById(after, "horse")?.health ?? 0);
    assert.equal(dealt, 23);
  });
});
