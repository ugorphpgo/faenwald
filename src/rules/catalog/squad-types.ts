/**
 * Каталог Типов отрядов. Числа перенесены из статьи «[CF] Боевая система»
 * (см. `.scratch/boevaya-sistema/spec.md`) и даны на сотню солдат.
 */

export type Branch = "cavalry" | "ranged" | "shock" | "spearmen";

/** Ступень бронированности. Задаёт бесплатный разворот и множители грязи и льда. */
export type Weight = "light" | "medium" | "heavy";

export type SquadTypeId =
  | "lightSpearman"
  | "mediumSpearman"
  | "heavySpearman"
  | "lightInfantry"
  | "mediumInfantry"
  | "heavyInfantry"
  | "lightCavalry"
  | "mediumCavalry"
  | "heavyCavalry"
  | "archer"
  | "horseArcher"
  | "longbowman"
  | "crossbowman";

export type SquadType = {
  readonly id: SquadTypeId;
  readonly branch: Branch;
  readonly weight: Weight;
  /** Здоровье на сотню солдат. */
  readonly health: number;
  /** Естественный Урон на сотню солдат. */
  readonly damage: number;
  /** Мораль на сотню солдат. */
  readonly morale: number;
  /** Базовая Скорость в Гексах за Ход. */
  readonly speed: number;
  /** Стоимость отряда в золоте; `null` — не нанимается. */
  readonly cost: number | null;
  /** Модификатор Таранного удара в процентах за Гекс разбега. */
  readonly chargeModifier?: number;
  /** Маневренность: разрешает перемещаться после атаки в том же Ходу. */
  readonly mobility?: boolean;
  /** Во что Отряд превращается Спешиванием, оставляя коней на Гексе. */
  readonly dismountsTo?: SquadTypeId;
  /** Во что Отряд превращается Седланием, подняв оставленных коней. */
  readonly mountsTo?: SquadTypeId;
  /** Множители исходящего урона по Роду войск цели. */
  readonly outgoingVsBranch?: Partial<Record<Branch, number>>;
  /** Множители входящего урона по источнику. */
  readonly incomingFrom?: Partial<Record<"ranged" | "charge", number>>;

  // --- Дальняя атака: поля ниже осмысленны только для branch: "ranged" ---

  /** Глубина конуса Навеса. По умолчанию 4. */
  readonly arcDepth?: number;
  /** Дальность Прямой наводки в Гексах по прямой. По умолчанию 2 ("гекс через гекс"). */
  readonly directDistance?: number;
  /** Множитель Ближнего боя. По умолчанию 0,5. */
  readonly meleeShotFactor?: number;
  /** Не может стрелять Навесом (арбалетчик). */
  readonly forbidsArcShot?: boolean;
  /** Стреляет не чаще раза в два Хода (арбалетчик). */
  readonly attacksEveryOtherTurn?: boolean;
  /** Игнорирует Тип-против-Типа сопротивление цели дальнему бою (арбалетчик
   *  «наносит полный урон тяжёлым»). */
  readonly ignoresRangedResistance?: boolean;
  /** Не привязан к Фронту: Навес, Прямая наводка и Зона провокации накрывают
   *  все шесть направлений (конный лучник). */
  readonly omniDirectional?: boolean;

  /** Не может быть целью Оппортуна дальнего боя (лёгкая кавалерия). */
  readonly immuneToRangedOpportunity?: boolean;
};

const type = (t: SquadType): SquadType => t;

export const SQUAD_TYPES: { readonly [K in SquadTypeId]: SquadType } = {
  // Копейщики
  lightSpearman: type({ id: "lightSpearman", branch: "spearmen", weight: "light", health: 80, damage: 12, morale: 70, speed: 3, cost: 30_000, incomingFrom: { ranged: 1.5 }, mountsTo: "lightCavalry" }),
  mediumSpearman: type({ id: "mediumSpearman", branch: "spearmen", weight: "medium", health: 120, damage: 15, morale: 85, speed: 2, cost: 50_000, incomingFrom: { charge: 0.75 }, mountsTo: "mediumCavalry" }),
  heavySpearman: type({ id: "heavySpearman", branch: "spearmen", weight: "heavy", health: 160, damage: 18, morale: 110, speed: 1, cost: 70_000, incomingFrom: { charge: 0.5, ranged: 0.5 }, mountsTo: "heavyCavalry" }),

  // Ударная пехота
  lightInfantry: type({ id: "lightInfantry", branch: "shock", weight: "light", health: 60, damage: 20, morale: 70, speed: 3, cost: 30_000, incomingFrom: { ranged: 1.5 } }),
  mediumInfantry: type({ id: "mediumInfantry", branch: "shock", weight: "medium", health: 90, damage: 25, morale: 85, speed: 2, cost: 50_000 }),
  heavyInfantry: type({ id: "heavyInfantry", branch: "shock", weight: "heavy", health: 120, damage: 30, morale: 100, speed: 1, cost: 70_000, incomingFrom: { charge: 0.75, ranged: 0.5 } }),

  // Кавалерия
  lightCavalry: type({ id: "lightCavalry", branch: "cavalry", weight: "light", health: 70, damage: 10, morale: 80, speed: 5, cost: 40_000, chargeModifier: 8, mobility: true, dismountsTo: "lightSpearman", outgoingVsBranch: { ranged: 1.5 }, incomingFrom: { ranged: 1.5 }, immuneToRangedOpportunity: true }),
  mediumCavalry: type({ id: "mediumCavalry", branch: "cavalry", weight: "medium", health: 95, damage: 15, morale: 90, speed: 4, cost: 90_000, chargeModifier: 16, mobility: true, dismountsTo: "mediumSpearman" }),
  heavyCavalry: type({ id: "heavyCavalry", branch: "cavalry", weight: "heavy", health: 120, damage: 25, morale: 100, speed: 3, cost: 160_000, chargeModifier: 24, mobility: true, dismountsTo: "heavySpearman", incomingFrom: { ranged: 0.5 } }),

  // Дальнобойные
  archer: type({ id: "archer", branch: "ranged", weight: "light", health: 50, damage: 6, morale: 70, speed: 3, cost: 25_000, mountsTo: "horseArcher" }),
  horseArcher: type({
    id: "horseArcher",
    branch: "ranged",
    weight: "medium",
    health: 80,
    damage: 6,
    morale: 80,
    speed: 5,
    cost: 60_000,
    arcDepth: 2,
    directDistance: 1,
    omniDirectional: true,
    mobility: true,
    dismountsTo: "archer",
  }),
  longbowman: type({ id: "longbowman", branch: "ranged", weight: "light", health: 60, damage: 10, morale: 80, speed: 3, cost: null }),
  // ⚠️ Статья даёт 40 как урон «с прямой наводкой», а не как базовый Урон Типа.
  // Наш конвейер всегда считает режимы как множитель База × 1/2/0,5 — чтобы
  // Прямая наводка (×2) дала ровно 40, база здесь 20, а не 40. Навеса у
  // арбалетчика нет вовсе (forbidsArcShot); Ближний бой берёт ту же базу 20 с
  // собственным множителем 0,75 — числа для него статья не даёт, это решение,
  // см. вопрос 5 в voprosy-avtoru.md.
  crossbowman: type({
    id: "crossbowman",
    branch: "ranged",
    weight: "medium",
    health: 60,
    damage: 20,
    morale: 80,
    speed: 3,
    cost: 75_000,
    forbidsArcShot: true,
    directDistance: 3,
    attacksEveryOtherTurn: true,
    ignoresRangedResistance: true,
    meleeShotFactor: 0.75,
  }),
};

/**
 * Порядок Родов войск при равной Скорости: кавалерия, затем дальнобойные, затем
 * ближний бой — причём ударная пехота раньше копейщиков.
 */
const BRANCH_ORDER: { readonly [K in Branch]: number } = {
  cavalry: 0,
  ranged: 1,
  shock: 2,
  spearmen: 3,
};

export const branchInitiativeRank = (branch: Branch): number => BRANCH_ORDER[branch];
