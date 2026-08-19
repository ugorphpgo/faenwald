import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validateSetup } from "./index.ts";
import type { Board, Hex, Setup, SetupViolationKind, SquadSetup } from "./index.ts";

const at = (col: number, row: number): Hex => ({ col, row });

const BARE: Board = { width: 12, height: 12 };

/** Карта с зонами: синие в двух северных рядах, красные в двух южных. */
const band = (rows: readonly number[]): readonly Hex[] =>
  rows.flatMap((row) => Array.from({ length: 12 }, (_, col) => at(col, row)));

const ZONED: Board = {
  ...BARE,
  deployment: { blue: band([0, 1]), red: band([10, 11]) },
  baggage: { blue: "north", red: "south" },
};

const blue: SquadSetup = { id: "blue", side: "blue", type: "mediumInfantry", hex: at(5, 1), facing: 1 };
const red: SquadSetup = { id: "red", side: "red", type: "mediumInfantry", hex: at(5, 10), facing: 4 };

const setup = (squads: readonly SquadSetup[], board: Board = ZONED, season?: Setup["season"]): Setup => ({
  board,
  squads,
  ...(season === undefined ? {} : { season }),
});

const kinds = (result: readonly { kind: SetupViolationKind }[]): readonly SetupViolationKind[] =>
  result.map((violation) => violation.kind);

describe("validateSetup: законная расстановка", () => {
  test("корректная расстановка даёт пустой список", () => {
    assert.deepEqual(validateSetup(setup([blue, red])), []);
  });

  test("Карта без объявленных Зон ничего не считает нарушением по зонам", () => {
    const anywhere = setup([{ ...blue, hex: at(5, 5) }, { ...red, hex: at(6, 6) }], BARE);
    assert.deepEqual(validateSetup(anywhere), []);
  });

  test("по одному Правителю на сторону — законно", () => {
    const withRulers = setup([
      { ...blue, ruler: true },
      { ...red, ruler: true },
    ]);
    assert.deepEqual(validateSetup(withRulers), []);
  });
});

describe("validateSetup: нарушения", () => {
  test("два Отряда на одном Гексе", () => {
    const clash = setup([blue, { ...red, side: "red", id: "intruder", hex: blue.hex }, red]);
    const found = validateSetup(clash).filter((violation) => violation.kind === "hexOccupied");

    assert.equal(found.length, 1, "одно нарушение на Гекс, а не по одному на Отряд");
    assert.deepEqual([...found[0]!.squads].sort(), ["blue", "intruder"]);
    assert.deepEqual(found[0]!.hex, blue.hex);
  });

  test("Отряд за границами Карты", () => {
    const outside = setup([{ ...blue, hex: at(12, 1) }, red]);
    assert.ok(kinds(validateSetup(outside)).includes("offBoard"));
  });

  test("за границей Карты не выдумываются проходимость и зоны", () => {
    const outside = validateSetup(setup([{ ...blue, hex: at(-1, 0) }, red]));
    assert.deepEqual(kinds(outside), ["offBoard"]);
  });

  test("Отряд на непроходимой Местности", () => {
    const rocky: Board = { ...ZONED, terrain: { [`${blue.hex.col},${blue.hex.row}`]: "mountain" } };
    assert.ok(kinds(validateSetup(setup([blue, red], rocky))).includes("impassable"));
  });

  test("зимой вода расстановке не мешает — она проходима", () => {
    const icy: Board = { ...ZONED, terrain: { [`${blue.hex.col},${blue.hex.row}`]: "water" } };

    assert.ok(kinds(validateSetup(setup([blue, red], icy))).includes("impassable"));
    assert.deepEqual(validateSetup(setup([blue, red], icy, "winter")), []);
  });

  test("Отряд вне Зоны расстановки своей стороны", () => {
    const strayed = setup([{ ...blue, hex: at(5, 5) }, red]);
    const found = validateSetup(strayed).filter((violation) => violation.kind === "outsideDeployment");

    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.squads, ["blue"]);
    assert.equal(found[0]?.side, "blue");
  });

  test("Отряд в Зоне расстановки противника", () => {
    // Зоны не пересекаются, поэтому чужая зона — частный случай «вне своей».
    const invader = setup([{ ...blue, hex: at(5, 10) }, red]);
    const found = validateSetup(invader).filter((violation) => violation.kind === "outsideDeployment");

    assert.deepEqual(found.map((violation) => violation.squads[0]), ["blue"]);
  });

  test("более одного Правителя на сторону", () => {
    const twoCrowns = setup([
      { ...blue, ruler: true },
      { id: "blue2", side: "blue", type: "mediumInfantry", hex: at(6, 1), facing: 1, ruler: true },
      red,
    ]);
    const found = validateSetup(twoCrowns).filter((violation) => violation.kind === "duplicateRuler");

    assert.equal(found.length, 1);
    assert.deepEqual([...found[0]!.squads].sort(), ["blue", "blue2"]);
    assert.equal(found[0]?.side, "blue");
  });

  test("сторона без единого Отряда", () => {
    const found = validateSetup(setup([blue])).filter((violation) => violation.kind === "emptySide");

    assert.equal(found.length, 1);
    assert.equal(found[0]?.side, "red");
  });

  test("неизвестный Тип Отряда", () => {
    const bogus = setup([{ ...blue, type: "dragon" as SquadSetup["type"] }, red]);
    const found = validateSetup(bogus).filter((violation) => violation.kind === "unknownType");

    assert.equal(found.length, 1);
    assert.equal(found[0]?.detail, "dragon");
  });

  test("два Отряда с одним идентификатором", () => {
    const twins = setup([blue, { ...blue, hex: at(6, 1) }, red]);
    assert.ok(kinds(validateSetup(twins)).includes("duplicateId"));
  });
});

describe("validateSetup: возвращает всё разом", () => {
  test("несколько независимых нарушений приходят одним списком", () => {
    const broken = setup([
      { ...blue, hex: at(5, 5) }, // вне своей Зоны
      { id: "ghost", side: "blue", type: "mediumInfantry", hex: at(99, 99), facing: 0 }, // за Картой
    ]);

    const found = kinds(validateSetup(broken));

    assert.ok(found.includes("outsideDeployment"));
    assert.ok(found.includes("offBoard"));
    assert.ok(found.includes("emptySide"), "у красных нет Отрядов");
    assert.ok(found.length >= 3, `ожидался список, получено: ${found.join(", ")}`);
  });
});
