import type { SquadTypeId } from "./catalog/squad-types.ts";
import type { TerrainId } from "./catalog/terrain.ts";
import type { RngState } from "./rng.ts";
import type { BattleReport, Departed } from "./report.ts";
import type { RulerFate } from "./rout.ts";
import type { Intent } from "./intent.ts";

export type Side = "blue" | "red";

/** Время года Боя. Зимой вода Карты перестаёт быть непроходимой. */
export type Season = "summer" | "winter";

/** Клетка карты в раскладке odd-r, pointy-top. */
export type Hex = { readonly col: number; readonly row: number };

/** Направление Отряда: одна из шести граней. */
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

export type SquadId = string;

/** Режим стрельбы дальнобойного Отряда. */
export type RangedMode = "arcShot" | "directShot" | "meleeShot";

/**
 * Взведённое право Оппортуна: `holder` может нанести внеочередной Удар по
 * `against`, потому что тот вошёл в его Зону провокации. Живёт в состоянии Боя
 * как отдельная связь между Отрядами, а не как поле на каждом из них — арность
 * "многие ко многим" (несколько врагов могут провоцировать одного и того же
 * Отряда за один Ход) естественно ложится на список пар.
 */
export type ArmedThreat = { readonly holder: SquadId; readonly against: SquadId };

/**
 * Кони, оставленные Спешиванием. Не Отряд: не ходят, не занимают Гекс и не
 * участвуют в Инициативе — просто лежат на карте, пока их не оседлают или не
 * спугнут.
 */
export type Horses = {
  readonly hex: Hex;
  readonly side: Side;
  /** Тип кавалерии, который получится при Седлании. */
  readonly mountsTo: SquadTypeId;
};

export type Board = {
  readonly width: number;
  readonly height: number;
  /** Местность по Гексам, ключ — "col,row". Отсутствующий Гекс считается равниной. */
  readonly terrain?: Readonly<Record<string, TerrainId>>;
};

/** Что Отряд уже израсходовал в этом Ходу. */
export type Spent = {
  readonly attacked: boolean;
  /** Атака была списана не на этом Ходу, а Оппортуном или Контратакой на чужом.
   *  Статья разрешает такому Отряду только развернуться. */
  readonly attackedOutOfTurn: boolean;
  readonly surged: boolean;
  readonly freeRotation: boolean;
};

export type Squad = {
  readonly id: SquadId;
  readonly side: Side;
  readonly type: SquadTypeId;
  /** Численность в солдатах; характеристики каталога умножаются на долю от сотни. */
  readonly headcount: number;
  readonly rank: number;
  readonly hex: Hex;
  readonly facing: Facing;
  readonly health: number;
  readonly morale: number;
  /** Остаток Запаса хода. Дробь копится между Ходами. */
  readonly movement: number;
  readonly spent: Spent;
  readonly ruler: boolean;
  /** Отряд обращён в Бегство и обязан покинуть карту кратчайшим маршрутом. */
  readonly routing: boolean;
  /**
   * Отряд израсходовал свою Атаку на чужом Ходу этого Раунда — Оппортуном
   * (всегда) или Контратакой (при включённой политике
   * `counterattackSpendsDefendersAttack`). Флаг потребляется началом его
   * следующего Хода и не переживает границу Раунда.
   */
  readonly attackSpentOutOfTurn: boolean;
  /** Боезапас дальнобойного Отряда: восемь выстрелов на Бой. У ближнего боя не
   *  расходуется и не проверяется. */
  readonly ammo: number;
  /** Сколько Ходов подряд ещё нельзя стрелять (арбалетчик — раз в два Хода). */
  readonly rangedCooldown: number;
  /** Сколько дальнобойных союзников этот Отряд уже снабдил Боезапасом за Бой —
   *  предел статьи, не более трёх. */
  readonly resuppliedCount: number;
  /** Гексов пройдено подряд вперёд в этом Ходу — разбег Таранного удара.
   *  Обнуляется началом Хода и любым разворотом. */
  readonly chargeSteps: number;
};

/**
 * Чьего решения ждёт доска. Фаза — часть состояния, а не поток управления: решение
 * внутри прерывания Оппортуна принадлежит другому игроку, и колбэк не пережил бы
 * сериализацию (`docs/adr/0001`).
 */
export type Phase =
  | { readonly kind: "turn"; readonly squad: SquadId }
  | { readonly kind: "rout"; readonly squad: SquadId }
  | {
      readonly kind: "opportunity";
      /** Держатели, ещё не ответившие; отвечает всегда первый в списке. */
      readonly holders: readonly SquadId[];
      /** Спровоцировавший Отряд — цель всех ответов в этой Фазе. */
      readonly against: SquadId;
      /** Намерение, объявленное провокатором и ждущее своей очереди. */
      readonly deferred: Intent;
    }
  | {
      readonly kind: "breakthrough";
      /** Ударная пехота, чья Атака выполнила условие Прорыва. */
      readonly attacker: SquadId;
      /** Отряд, которого можно (не обязательно) отодвинуть. */
      readonly target: SquadId;
    }
  | { readonly kind: "over"; readonly report: BattleReport };

/** Политики, по которым идёт эта партия. Хранятся в состоянии, чтобы сохранённый
 * Бой переигрывался по своим правилам, а не по текущим. */
export type Policies = {
  /** Расходует ли Контратака атаку защитника на его собственном Ходу.
   *  Из статьи не выводится — решение о балансе (`docs/adr/0004`). */
  readonly counterattackSpendsDefendersAttack: boolean;
  /** Переносится ли между Ходами целая часть Запаса хода, а не только дробь.
   *  Буква статьи говорит «дробный остаток меньше 1 гекса», но при ней Отряд
   *  Скорости 1 не может войти ни в грязь, ни на подъём — никогда
   *  (`docs/adr/0008`). */
  readonly movementCarriesWholeHexes: boolean;
};

export type Event =
  | { readonly kind: "turnEnded"; readonly squad: SquadId }
  | { readonly kind: "roundEnded"; readonly round: number }
  | { readonly kind: "stepped"; readonly squad: SquadId; readonly from: Hex; readonly to: Hex; readonly cost: number }
  /** Зимний лёд провалился под Отрядом: `hex` — Гекс воды, куда он шагал и не
   *  дошёл, `health` — отнятое Здоровье. Запас хода за попытку всё равно
   *  потрачен, событие `stepped` в этот же Ход не приходит. */
  | { readonly kind: "iceCracked"; readonly squad: SquadId; readonly hex: Hex; readonly health: number }
  | { readonly kind: "rotated"; readonly squad: SquadId; readonly facing: Facing; readonly free: boolean }
  | { readonly kind: "surged"; readonly squad: SquadId; readonly movement: number }
  | {
      readonly kind: "attacked";
      readonly attacker: SquadId;
      readonly defender: SquadId;
      readonly side: "front" | "flank" | "rear";
      readonly health: number;
      readonly morale: number;
      readonly counterattack: boolean;
    }
  | {
      readonly kind: "rangedAttacked";
      readonly attacker: SquadId;
      readonly defender: SquadId;
      readonly mode: RangedMode;
      readonly side: "front" | "flank" | "rear";
      readonly health: number;
      readonly morale: number;
      /** Только для Ближнего боя: моральный самоурон стрелка. */
      readonly selfMorale?: number;
    }
  | { readonly kind: "ammoRestocked"; readonly squad: SquadId; readonly by: "baggage" | "resupply" }
  | { readonly kind: "squadDestroyed"; readonly squad: SquadId }
  | { readonly kind: "squadRouted"; readonly squad: SquadId }
  | { readonly kind: "squadLeftBoard"; readonly squad: SquadId }
  | { readonly kind: "moraleShock"; readonly squad: SquadId; readonly amount: number }
  | { readonly kind: "rulerFate"; readonly squad: SquadId; readonly fate: RulerFate }
  | { readonly kind: "battleOver"; readonly winner: Side | null }
  | { readonly kind: "opportunityArmed"; readonly holder: SquadId; readonly against: SquadId }
  | {
      readonly kind: "opportunityStrike";
      readonly holder: SquadId;
      readonly against: SquadId;
      readonly side: "front" | "flank" | "rear";
      readonly health: number;
      readonly morale: number;
    }
  | { readonly kind: "opportunityDeclined"; readonly holder: SquadId; readonly against: SquadId }
  | {
      readonly kind: "breakthroughPushed";
      readonly attacker: SquadId;
      readonly target: SquadId;
      /** Отряды, сдвинутые цепочкой, от цели наружу. */
      readonly chain: readonly SquadId[];
    }
  | { readonly kind: "breakthroughDeclined"; readonly attacker: SquadId; readonly target: SquadId }
  | { readonly kind: "breakthroughFailed"; readonly attacker: SquadId; readonly target: SquadId }
  | {
      /** Копейщик в Сомкнутом строю вернул атакующему урон его же разбега. */
      readonly kind: "chargeReflected";
      readonly reflector: SquadId;
      readonly attacker: SquadId;
      readonly health: number;
    }
  | {
      readonly kind: "dismounted";
      readonly squad: SquadId;
      readonly becomes: SquadTypeId;
      readonly hex: Hex;
    }
  | {
      readonly kind: "mounted";
      readonly squad: SquadId;
      readonly becomes: SquadTypeId;
    }
  | { readonly kind: "horsesFled"; readonly hex: Hex };

export type BattleState = {
  readonly board: Board;
  readonly policies: Policies;
  /** Хранится в состоянии по той же причине, что и политики: сохранённый Бой
   *  обязан переигрываться по своему Времени года, а не по текущему. */
  readonly season: Season;
  readonly squads: readonly Squad[];
  readonly round: number;
  /** Очередь Хода на Раунд, по Инициативе. */
  readonly order: readonly SquadId[];
  /** Индекс текущего Отряда в `order`. */
  readonly turnIndex: number;
  readonly phase: Phase;
  readonly rng: RngState;
  /** Отряды, покинувшие доску: нужны Отчёту о бое. */
  readonly departed: readonly Departed[];
  /** Взведённые и ещё не потреблённые права Оппортуна. */
  readonly armedThreats: readonly ArmedThreat[];
  /** Кони, оставленные Спешиванием и ждущие Седлания. */
  readonly horses: readonly Horses[];
  readonly log: readonly Event[];
};

export type RejectionKind =
  | "wrongPhase"
  | "unknownSquad"
  | "notInFront"
  | "hexOccupied"
  | "impassable"
  | "noMovement"
  | "sameFacing"
  | "alreadySurged"
  | "surgeBlocked"
  | "notEnoughMorale"
  | "alreadyAttacked"
  | "notAnEnemy"
  | "routing"
  | "notShortestRoute"
  | "battleOver"
  | "notRanged"
  | "requiresRangedAttack"
  | "outOfRange"
  | "outOfAmmo"
  | "reloading"
  | "modeForbidden"
  | "lineBlocked"
  | "immuneToArcShot"
  | "cannotResupply"
  | "cannotDismount"
  | "noHorses";

export type Rejection = { readonly kind: RejectionKind; readonly detail?: string };

export type Applied =
  | { readonly ok: true; readonly state: BattleState; readonly events: readonly Event[] }
  | { readonly ok: false; readonly reason: Rejection };

export type SquadSetup = {
  readonly id: SquadId;
  readonly side: Side;
  readonly type: SquadTypeId;
  readonly hex: Hex;
  readonly facing: Facing;
  readonly headcount?: number;
  readonly rank?: number;
  readonly ruler?: boolean;
};

export type Setup = {
  readonly board: Board;
  readonly squads: readonly SquadSetup[];
  readonly season?: Season;
};

export type PolicyOverrides = Partial<Policies>;

export const DEFAULT_POLICIES: Policies = {
  counterattackSpendsDefendersAttack: false,
  movementCarriesWholeHexes: true,
};

export const DEFAULT_SEASON: Season = "summer";

export type { Intent };
