/** Местность. Правила перенесены из статьи «[CF] Боевая система». */

export type TerrainId =
  | "plain"
  | "mud"
  | "thicket"
  | "forest"
  | "foothill"
  | "hill"
  | "mountain"
  | "water"
  | "swamp"
  | "road"
  | "settlement";

export type Terrain = {
  readonly id: TerrainId;
  readonly passable: boolean;
  /** Множитель базовой стоимости входа для всех Отрядов. */
  readonly costFactor: number;
  /** Фиксированная стоимость входа для кавалерии, если она отличается. */
  readonly cavalryCost?: number;
  /** Кавалерия не может применять Ускорение, находясь здесь. */
  readonly blocksSurgeForCavalry?: boolean;
  /** Кавалерия за Ход проходит не более одного Гекса. */
  readonly capsCavalryToOneStep?: boolean;
  /** Уровень высоты: влияет на множители урона и дальность стрельбы. */
  readonly elevation: 0 | 1 | 2;
  /** Множитель входящего урона от дальнего боя. */
  readonly rangedDamageFactor: number;
  /** Не может быть целью Навеса. */
  readonly immuneToArcShot?: boolean;
  /** Добавочная доля к бонусу Сомкнутого строя копейщика, стоящего здесь. */
  readonly shieldWallBonus?: number;
  /** Топкая Местность: лёгкие наносят тяжёлым удвоенный урон, если оба здесь стоят. */
  readonly muddy?: boolean;
  /** Сколько Гексов Запаса хода теряет кавалерия, начинающая здесь Ход. */
  readonly cavalryMovementPenalty?: number;
};

const terrain = (t: Terrain): Terrain => t;

export const TERRAIN: { readonly [K in TerrainId]: Terrain } = {
  plain: terrain({ id: "plain", passable: true, costFactor: 1, elevation: 0, rangedDamageFactor: 1 }),
  mud: terrain({ id: "mud", passable: true, costFactor: 2, elevation: 0, rangedDamageFactor: 1, muddy: true }),
  // «Как грязь, но затраты ×3» читается как «те же правила боя, другая цена входа».
  swamp: terrain({ id: "swamp", passable: true, costFactor: 3, elevation: 0, rangedDamageFactor: 1, muddy: true }),
  road: terrain({ id: "road", passable: true, costFactor: 0.5, elevation: 0, rangedDamageFactor: 1 }),
  thicket: terrain({ id: "thicket", passable: true, costFactor: 1, cavalryCost: 2, elevation: 0, rangedDamageFactor: 0.75 }),
  forest: terrain({
    id: "forest",
    passable: true,
    costFactor: 1,
    blocksSurgeForCavalry: true,
    capsCavalryToOneStep: true,
    elevation: 0,
    rangedDamageFactor: 0.5,
  }),
  foothill: terrain({ id: "foothill", passable: true, costFactor: 1, elevation: 1, rangedDamageFactor: 1 }),
  hill: terrain({ id: "hill", passable: true, costFactor: 1, elevation: 2, rangedDamageFactor: 1 }),
  settlement: terrain({
    id: "settlement",
    passable: true,
    costFactor: 1,
    elevation: 0,
    rangedDamageFactor: 1,
    immuneToArcShot: true,
    shieldWallBonus: 0.05,
    cavalryMovementPenalty: 2,
  }),
  mountain: terrain({ id: "mountain", passable: false, costFactor: Number.POSITIVE_INFINITY, elevation: 2, rangedDamageFactor: 1 }),
  water: terrain({ id: "water", passable: false, costFactor: Number.POSITIVE_INFINITY, elevation: 0, rangedDamageFactor: 1 }),
};
