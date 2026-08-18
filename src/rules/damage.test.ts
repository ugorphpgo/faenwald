import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveDamage } from "./damage.ts";
import type { DamageInput } from "./damage.ts";

const base: DamageInput = {
  naturalDamage: 20,
  headcount: 100,
  health: 100,
  maxHealth: 100,
  modifiers: [],
  moraleModifiers: [],
  moraleExemptFromCap: false,
};

describe("Конвейер урона", () => {
  test("без модификаторов урон равен естественному", () => {
    assert.deepEqual(resolveDamage(base), { health: 20, morale: 20 });
  });

  test("Численность режет урон долей от сотни", () => {
    assert.deepEqual(resolveDamage({ ...base, headcount: 25 }), { health: 5, morale: 5 });
  });

  test("Отряд ниже половины Здоровья наносит половину Урона", () => {
    assert.deepEqual(resolveDamage({ ...base, health: 49 }), { health: 10, morale: 10 });
  });

  test("на ровно половине Здоровья Урон уже урезан", () => {
    // «Сохраняет показатели урона, пока не потеряет половину здоровья; дальше
    // наносит половину» — на ровно половине потеря половины уже наступила.
    assert.deepEqual(resolveDamage({ ...base, health: 50 }), { health: 10, morale: 10 });
  });

  test("на единицу выше половины Урон ещё полный", () => {
    assert.deepEqual(resolveDamage({ ...base, health: 51 }), { health: 20, morale: 20 });
  });

  test("граница считается от максимума с Численностью, а не от каталожного числа", () => {
    // Отряд в четверть Численности: и Урон, и максимум Здоровья урезаны вчетверо.
    // Половина ЕГО максимума — 12,5, а не 50.
    const quarter: DamageInput = { ...base, headcount: 25, maxHealth: 25, health: 13 };
    assert.deepEqual(resolveDamage(quarter), { health: 5, morale: 5 });
    assert.deepEqual(resolveDamage({ ...quarter, health: 12.5 }), { health: 3, morale: 3 });
  });

  test("модификаторы перемножаются", () => {
    assert.deepEqual(resolveDamage({ ...base, modifiers: [1.25, 0.8] }), { health: 20, morale: 20 });
    assert.deepEqual(resolveDamage({ ...base, modifiers: [0.75, 0.5] }), { health: 8, morale: 8 });
  });

  test("модификаторы стороны бьют только по Морали", () => {
    assert.deepEqual(resolveDamage({ ...base, moraleModifiers: [1.5] }), { health: 20, morale: 30 });
  });

  test("округление арифметическое", () => {
    // 18 × 1.25 = 22.5 → 23 (пример из статьи)
    assert.equal(resolveDamage({ ...base, naturalDamage: 18, modifiers: [1.25] }).health, 23);
    // 25 × 0.75 × 1.5 × 0.5 × 0.6 = 8.4375 → 8 (пример из статьи)
    assert.equal(
      resolveDamage({ ...base, naturalDamage: 25, modifiers: [0.75, 1.5, 0.5, 0.6] }).health,
      8,
    );
  });

  test("Предельный урон режет итог до ×3 от естественного", () => {
    // Лучник с восемью атаки не может нанести больше 24.
    assert.equal(resolveDamage({ ...base, naturalDamage: 8, modifiers: [10] }).health, 24);
  });

  test("Предельный урон считается от Урона, приведённого к Численности", () => {
    assert.equal(
      resolveDamage({ ...base, naturalDamage: 8, headcount: 50, modifiers: [10] }).health,
      12,
    );
  });

  test("моральный урон может быть выведен из-под потолка", () => {
    const capped = resolveDamage({ ...base, naturalDamage: 8, modifiers: [10] });
    const exempt = resolveDamage({ ...base, naturalDamage: 8, modifiers: [10], moraleExemptFromCap: true });

    assert.equal(capped.morale, 24);
    assert.equal(exempt.morale, 80);
  });

  test("урон никогда не отрицателен", () => {
    assert.deepEqual(resolveDamage({ ...base, modifiers: [0] }), { health: 0, morale: 0 });
  });
});
