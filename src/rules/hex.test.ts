import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { neighbour, neighbours, distance, sides, cone, facingTowards } from "./hex.ts";
import type { Hex } from "./state.ts";

const at = (col: number, row: number): Hex => ({ col, row });
const key = (hex: Hex): string => `${hex.col},${hex.row}`;
const keys = (hexes: readonly Hex[]): string[] => hexes.map(key).sort();

describe("Гексы: раскладка odd-r", () => {
  test("сосед на чётной строке", () => {
    const origin = at(3, 2);
    assert.deepEqual(neighbour(origin, 0), at(4, 2)); // E
    assert.deepEqual(neighbour(origin, 1), at(3, 3)); // SE
    assert.deepEqual(neighbour(origin, 2), at(2, 3)); // SW
    assert.deepEqual(neighbour(origin, 3), at(2, 2)); // W
    assert.deepEqual(neighbour(origin, 4), at(2, 1)); // NW
    assert.deepEqual(neighbour(origin, 5), at(3, 1)); // NE
  });

  test("сосед на нечётной строке смещён", () => {
    const origin = at(3, 3);
    assert.deepEqual(neighbour(origin, 0), at(4, 3)); // E
    assert.deepEqual(neighbour(origin, 1), at(4, 4)); // SE
    assert.deepEqual(neighbour(origin, 2), at(3, 4)); // SW
    assert.deepEqual(neighbour(origin, 3), at(2, 3)); // W
    assert.deepEqual(neighbour(origin, 4), at(3, 2)); // NW
    assert.deepEqual(neighbour(origin, 5), at(4, 2)); // NE
  });

  test("у Гекса ровно шесть различных соседей", () => {
    const all = neighbours(at(4, 5));
    assert.equal(all.length, 6);
    assert.equal(new Set(all.map(key)).size, 6);
  });

  test("каждый сосед находится на расстоянии один", () => {
    for (const origin of [at(3, 2), at(3, 3), at(0, 0), at(7, 6)]) {
      for (const near of neighbours(origin)) {
        assert.equal(distance(origin, near), 1, `${key(origin)} -> ${key(near)}`);
      }
    }
  });

  test("расстояние симметрично и растёт по прямой", () => {
    assert.equal(distance(at(2, 2), at(2, 2)), 0);
    assert.equal(distance(at(2, 2), at(5, 2)), 3);
    assert.equal(distance(at(5, 2), at(2, 2)), 3);
  });
});

describe("Гексы: стороны Отряда", () => {
  test("шесть соседей делятся на Фронт, Фланг и Тыл по два", () => {
    const origin = at(4, 4);
    const split = sides(origin, 0);

    assert.equal(split.front.length, 2);
    assert.equal(split.flank.length, 2);
    assert.equal(split.rear.length, 2);
    assert.deepEqual(
      keys([...split.front, ...split.flank, ...split.rear]),
      keys(neighbours(origin)),
    );
  });

  test("Тыл противоположен Фронту", () => {
    const origin = at(4, 4);
    const facingEast = sides(origin, 0);
    const facingWest = sides(origin, 3);

    assert.deepEqual(keys(facingEast.front), keys(facingWest.rear));
    assert.deepEqual(keys(facingEast.rear), keys(facingWest.front));
  });

  test("разворот сдвигает стороны по кругу", () => {
    const origin = at(4, 4);
    for (let facing = 0; facing < 6; facing++) {
      const split = sides(origin, facing as 0 | 1 | 2 | 3 | 4 | 5);
      assert.equal(split.front.length + split.flank.length + split.rear.length, 6);
    }
  });

  test("Направление на соседний Гекс покрывает его Фронтом", () => {
    const origin = at(4, 4);
    for (const target of neighbours(origin)) {
      const facing = facingTowards(origin, target);
      assert.notEqual(facing, undefined);
      if (facing === undefined) throw new Error("unreachable");
      assert.ok(keys(sides(origin, facing).front).includes(key(target)));
    }
  });
});

describe("Гексы: конус", () => {
  test("на расстоянии d конус содержит d+1 Гексов", () => {
    const origin = at(6, 6);
    const covered = cone(origin, 0, 4);

    for (let d = 1; d <= 4; d++) {
      const ring = covered.filter((hex) => distance(origin, hex) === d);
      assert.equal(ring.length, d + 1, `на расстоянии ${d}`);
    }
  });

  test("конус глубиной четыре накрывает четырнадцать Гексов", () => {
    assert.equal(cone(at(6, 6), 0, 4).length, 14);
  });

  test("конус начинается с двух Гексов Фронта", () => {
    const origin = at(6, 6);
    const covered = cone(origin, 2, 4);
    const nearest = covered.filter((hex) => distance(origin, hex) === 1);

    assert.deepEqual(keys(nearest), keys(sides(origin, 2).front));
  });

  test("конус не содержит собственный Гекс и не повторяется", () => {
    const origin = at(6, 6);
    const covered = cone(origin, 1, 4);

    assert.ok(!covered.some((hex) => key(hex) === key(origin)));
    assert.equal(new Set(covered.map(key)).size, covered.length);
  });

  test("конусы противоположных Направлений не пересекаются", () => {
    const origin = at(9, 9);
    const forward = new Set(cone(origin, 0, 4).map(key));
    const backward = cone(origin, 3, 4).map(key);

    assert.ok(!backward.some((hex) => forward.has(hex)));
  });
});
