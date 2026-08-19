/**
 * Ядро правил боя Faenwald — единственный публичный файл модуля.
 *
 * Канон правил — статья «[CF] Боевая система»; перенос с числами лежит в
 * `.scratch/boevaya-sistema/spec.md`, словарь понятий — в `CONTEXT.md`.
 * Ядро не импортирует React и не знает ни про отрисовку, ни про сеть.
 */

import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import { TERRAIN } from "./catalog/terrain.ts";
import { FACINGS, distance, neighbour, sameHex, sides } from "./hex.ts";
import { initiativeOrder } from "./turn-order.ts";
import { facesHex, inAttackReach, isEnemy, maxHealthOf, resolveStrike, strikeSide } from "./attack.ts";
import { rearVulnerabilityFactor, reflectsCharge, shieldWallFactor } from "./formation.ts";
import { MOUNT_MOVEMENT_COST, convertTo, hasMobility, isCharging } from "./cavalry.ts";
import { rangeBonus, strikeElevationFactor } from "./elevation.ts";
import {
  AMMO_CAPACITY,
  RELOAD_COOLDOWN,
  RESUPPLY_LIMIT,
  arcReach,
  blockingSquad,
  directLines,
  forestBlocksLine,
  meleeShotReach,
  meleeShotSelfMorale,
  resolveRangedStrike,
} from "./ranged.ts";
import { scaleToHeadcount } from "./scale.ts";
import { ICE_CRACK_DAMAGE_FRACTION, iceCrackChancePercent } from "./ice.ts";
import { mudWeightFactor } from "./mud.ts";
import { armThreatsFor, armedAgainst } from "./opportunity.ts";
import {
  SURGE_MORALE_COST,
  grantMovement,
  isPassable,
  rotationIsFree,
  spearmanSidewaysFactor,
  stepCost,
  stepEndsMovement,
  surgeBlocked,
  terrainAt,
} from "./movement.ts";
import {
  RULER_MORALE_BONUS,
  atEdge,
  distanceToEdge,
  moraleShock,
  rulerFateFromRoll,
  sideOpposing,
} from "./rout.ts";
import { buildReport, departedFrom } from "./report.ts";
import { roll, seedRng } from "./rng.ts";
import { DEFAULT_POLICIES, DEFAULT_SEASON } from "./state.ts";
import type {
  ArmedThreat,
  Applied,
  BattleState,
  Board,
  Event,
  Facing,
  Hex,
  Policies,
  PolicyOverrides,
  RangedMode,
  Rejection,
  Season,
  Setup,
  Side,
  Horses,
  Squad,
  SquadId,
  SquadSetup,
} from "./state.ts";
import type { Departed } from "./report.ts";
import type { RngState } from "./rng.ts";
import type { Intent } from "./intent.ts";

export type {
  ArmedThreat,
  Applied,
  BattleState,
  Board,
  BoardEdge,
  Event,
  Facing,
  Hex,
  Phase,
  Policies,
  PolicyOverrides,
  RangedMode,
  Rejection,
  RejectionKind,
  Season,
  Setup,
  Side,
  Horses,
  Spent,
  Squad,
  SquadId,
  SquadSetup,
} from "./state.ts";
export type { Intent } from "./intent.ts";
export type { Branch, SquadType, SquadTypeId, Weight } from "./catalog/squad-types.ts";
export type { Terrain, TerrainId } from "./catalog/terrain.ts";
export type { BattleReport, Fate, SquadOutcome } from "./report.ts";
export type { RulerFate } from "./rout.ts";
export { SQUAD_TYPES } from "./catalog/squad-types.ts";
export { TERRAIN } from "./catalog/terrain.ts";

const FRESH_SPENT = { attacked: false, attackedOutOfTurn: false, surged: false, freeRotation: false } as const;

const squadFromSetup = (setup: SquadSetup): Squad => {
  const type = SQUAD_TYPES[setup.type];
  const headcount = setup.headcount ?? 100;
  return {
    id: setup.id,
    side: setup.side,
    type: setup.type,
    headcount,
    rank: setup.rank ?? 1,
    hex: setup.hex,
    facing: setup.facing,
    health: scaleToHeadcount(type.health, headcount),
    morale: scaleToHeadcount(type.morale, headcount),
    movement: 0,
    spent: FRESH_SPENT,
    ruler: setup.ruler ?? false,
    routing: false,
    attackSpentOutOfTurn: false,
    ammo: type.branch === "ranged" ? AMMO_CAPACITY : 0,
    rangedCooldown: 0,
    resuppliedCount: 0,
    chargeSteps: 0,
  };
};

export const squadById = (state: BattleState, id: SquadId): Squad | undefined =>
  state.squads.find((squad) => squad.id === id);

const squadAt = (state: BattleState, hex: Hex): Squad | undefined =>
  state.squads.find((squad) => sameHex(squad.hex, hex));

/** Отряд, чьего решения ждёт доска. Не вызывается в Фазах без единственного Отряда. */
const active = (state: BattleState): Squad => {
  if (state.phase.kind === "over" || state.phase.kind === "opportunity" || state.phase.kind === "breakthrough") {
    throw new Error("В этой Фазе нет одного активного Отряда");
  }
  const found = squadById(state, state.phase.squad);
  if (found === undefined) throw new Error(`Отряд вне доски: ${state.phase.squad}`);
  return found;
};

/**
 * Начало Хода: Отряд получает Скорость поверх накопленного остатка. Если этим
 * Раундом он уже израсходовал Атаку на чужом Ходу — Оппортуном или Контратакой
 * под списывающей политикой, — она приходит уже потраченной, и Отряду остаётся
 * только развернуться. Сам флаг при этом потребляется и Ход не переживает.
 */
const beginTurn = (board: Board, policies: Policies, squad: Squad): Squad => ({
  ...squad,
  movement: grantMovement(board, squad, policies.movementCarriesWholeHexes),
  spent: {
    ...FRESH_SPENT,
    attacked: squad.attackSpentOutOfTurn,
    attackedOutOfTurn: squad.attackSpentOutOfTurn,
  },
  attackSpentOutOfTurn: false,
  rangedCooldown: Math.max(0, squad.rangedCooldown - 1),
  // Разбег живёт ровно один Ход.
  chargeSteps: 0,
});

/**
 * Стороны, у которых остались Отряды на доске. Бегущий Отряд всё ещё здесь —
 * он не исчезает, пока не дойдёт до края (Бегство, `CONTEXT.md`), поэтому Бой
 * не обрывается в момент слома Морали последнего Отряда стороны, а даёт ему
 * дойти или погибнуть в пути.
 */
const standingSides = (squads: readonly Squad[]): readonly Side[] => {
  const sidesLeft = new Set<Side>();
  for (const squad of squads) sidesLeft.add(squad.side);
  return [...sidesLeft];
};

/** Промежуточное состояние доски, пока разрешается один Удар и его последствия. */
type Board_ = {
  squads: readonly Squad[];
  departed: readonly Departed[];
  rng: RngState;
  armedThreats: readonly ArmedThreat[];
  horses: readonly Horses[];
  events: Event[];
};

/**
 * Доводит доску до устойчивого состояния: снимает уничтоженных, обращает в Бегство
 * сломленных и разносит Мораль окружения. Волна повторяется, пока она кого-то
 * задевает — разгром бывает заразным.
 */
const settle = (board: Board_): Board_ => {
  let { squads, departed, rng, armedThreats } = board;
  const horses = board.horses;
  const events = board.events;

  for (let wave = 0; wave < 32; wave++) {
    const destroyed = squads.find((squad) => squad.health <= 0);
    const broken = destroyed ?? squads.find((squad) => squad.morale <= 0 && !squad.routing);
    if (broken === undefined) break;

    const isDestroyed = broken.health <= 0;
    let survivors = isDestroyed
      ? squads.filter((squad) => squad.id !== broken.id)
      : squads.map((squad) => (squad.id === broken.id ? { ...squad, routing: true } : squad));

    if (isDestroyed) {
      departed = [...departed, departedFrom(broken, "destroyed")];
      events.push({ kind: "squadDestroyed", squad: broken.id });
    } else {
      events.push({ kind: "squadRouted", squad: broken.id });
    }

    const shocks = moraleShock(survivors, broken);
    survivors = survivors.map((squad) => {
      const shock = shocks.get(squad.id);
      if (shock === undefined) return squad;
      events.push({ kind: "moraleShock", squad: squad.id, amount: shock });
      return { ...squad, morale: squad.morale - shock };
    });

    // Правитель уходит с поля вместе со своим Отрядом — и уносит свой бонус Морали.
    if (broken.ruler && isDestroyed) {
      const rolled = roll(rng, 3);
      rng = rolled.state;
      events.push({ kind: "rulerFate", squad: broken.id, fate: rulerFateFromRoll(rolled.value) });
      survivors = survivors.map((squad) =>
        squad.side === broken.side ? { ...squad, morale: squad.morale - RULER_MORALE_BONUS } : squad,
      );
    }

    squads = survivors;
  }

  // Право Оппортуна не переживает своего держателя: он должен быть на доске, не
  // в Бегстве и не успевшим уже потратить Атаку — иначе исполнить право нечем.
  // Провокатор обязан лишь оставаться на доске — Бегство его не спасает.
  const eligibleHolders = new Set(
    squads.filter((squad) => !squad.routing && !squad.spent.attacked).map((squad) => squad.id),
  );
  const onBoard = new Set(squads.map((squad) => squad.id));
  armedThreats = armedThreats.filter((threat) => eligibleHolders.has(threat.holder) && onBoard.has(threat.against));

  return { squads, departed, rng, armedThreats, horses, events };
};

const finish = (state: BattleState, board: Board_, winner: Side | null): Applied => {
  // Бежавшие Отряды покидают поле вместе с концом Боя.
  const stillRouting = board.squads.filter((squad) => squad.routing);
  const departed = [...board.departed, ...stillRouting.map((squad) => departedFrom(squad, "routed"))];
  const onBoard = board.squads.filter((squad) => !squad.routing);
  const report = buildReport(onBoard, departed, state.round, winner);

  board.events.push({ kind: "battleOver", winner });
  return {
    ok: true,
    state: {
      ...state,
      squads: board.squads,
      departed,
      rng: board.rng,
      armedThreats: board.armedThreats,
      horses: board.horses,
      phase: { kind: "over", report },
      log: [...state.log, ...board.events],
    },
    events: board.events,
  };
};

const reject = (kind: Rejection["kind"]): Applied => ({ ok: false, reason: { kind } });

/**
 * Записывает результат намерения. Если Бой на этом кончился — переводит в Фазу
 * окончания, иначе оставляет ход за тем же Отрядом.
 *
 * Отдельно чинит Фазу, если её Отряд не пережил собственного намерения:
 * Контратака и Отражение бьют в ответ, и активный Отряд вполне может погибнуть
 * или сломаться посреди своего же Хода. Оставить Фазу указывающей на него
 * значило бы уронить ядро на следующем же обращении.
 */
const commit = (state: BattleState, board: Board_): Applied => {
  const settled = settle(board);
  const left = standingSides(settled.squads);
  if (left.length <= 1) return finish(state, settled, left[0] ?? null);

  const next: BattleState = {
    ...state,
    squads: settled.squads,
    departed: settled.departed,
    rng: settled.rng,
    armedThreats: settled.armedThreats,
    horses: settled.horses,
    log: [...state.log, ...settled.events],
  };

  if (next.phase.kind === "turn" || next.phase.kind === "rout") {
    const holder = squadById(next, next.phase.squad);
    // Погиб — Ход достаётся следующему живому в очереди.
    if (holder === undefined) return advanceTurn(next);
    // Сломлен — доигрывает свой Ход уже по правилам Бегства.
    if (holder.routing && next.phase.kind === "turn") {
      return { ok: true, state: { ...next, phase: { kind: "rout", squad: holder.id } }, events: settled.events };
    }
  }

  return { ok: true, state: next, events: settled.events };
};

/**
 * Кони разбегаются от боя на их Гексе и от дальней атаки, проходящей через
 * него. Возвращает уцелевших и дописывает события о сбежавших.
 */
const scareHorses = (
  horses: readonly Horses[],
  disturbed: readonly Hex[],
  events: Event[],
): readonly Horses[] => {
  const scared = horses.filter((herd) => disturbed.some((hex) => sameHex(hex, herd.hex)));
  for (const herd of scared) events.push({ kind: "horsesFled", hex: herd.hex });
  return scared.length === 0 ? horses : horses.filter((herd) => !scared.includes(herd));
};

const withSquad = (state: BattleState, next: Squad, events: Event[]): Board_ => ({
  squads: state.squads.map((squad) => (squad.id === next.id ? next : squad)),
  departed: state.departed,
  rng: state.rng,
  armedThreats: state.armedThreats,
  horses: state.horses,
  events,
});

const phaseFor = (squad: Squad): BattleState["phase"] =>
  squad.routing ? { kind: "rout", squad: squad.id } : { kind: "turn", squad: squad.id };

/** Собирает Бой из расстановки. Зерно делает партию воспроизводимой. */
export const start = (setup: Setup, policies: PolicyOverrides, seed: number): BattleState => {
  const placed = setup.squads.map(squadFromSetup);
  const rulerSides = new Set(placed.filter((squad) => squad.ruler).map((squad) => squad.side));
  const withRuler = placed.map((squad) =>
    rulerSides.has(squad.side) ? { ...squad, morale: squad.morale + RULER_MORALE_BONUS } : squad,
  );

  const order = initiativeOrder(withRuler);
  const first = order[0];
  if (first === undefined) throw new Error("Бой требует хотя бы одного Отряда");

  const settledPolicies: Policies = { ...DEFAULT_POLICIES, ...policies };
  const squads = withRuler.map((squad) =>
    squad.id === first ? beginTurn(setup.board, settledPolicies, squad) : squad,
  );
  const opener = squads.find((squad) => squad.id === first);
  if (opener === undefined) throw new Error("Очередь Хода повреждена");

  return {
    board: setup.board,
    policies: settledPolicies,
    season: setup.season ?? DEFAULT_SEASON,
    squads,
    round: 1,
    order,
    turnIndex: 0,
    phase: phaseFor(opener),
    rng: seedRng(seed),
    departed: [],
    armedThreats: [],
    horses: [],
    log: [],
  };
};

const advanceTurn = (state: BattleState): Applied => {
  if (state.phase.kind === "over") return reject("battleOver");
  const finished = state.order[state.turnIndex];
  if (finished === undefined) throw new Error("Очередь Хода пуста");

  const events: Event[] = [{ kind: "turnEnded", squad: finished }];

  const openTurn = (
    squad: Squad,
    round: number,
    order: readonly SquadId[],
    index: number,
    squads: readonly Squad[] = state.squads,
  ): Applied => ({
    ok: true,
    state: {
      ...state,
      round,
      order,
      turnIndex: index,
      squads: squads.map((candidate) =>
        candidate.id === squad.id ? beginTurn(state.board, state.policies, candidate) : candidate,
      ),
      phase: phaseFor(squad),
      log: [...state.log, ...events],
    },
    events,
  });

  // Уничтоженные Отряды остаются в очереди Раунда, но Хода не получают.
  for (let index = state.turnIndex + 1; index < state.order.length; index++) {
    const candidate = state.order[index];
    const squad = candidate === undefined ? undefined : squadById(state, candidate);
    if (squad !== undefined) return openTurn(squad, state.round, state.order, index);
  }

  // Раунд закрыт: очередь пересчитывается, потому что состав доски мог измениться.
  // Списание Атаки Контратакой не переживает границу Раунда — то, что случилось на
  // чужом Ходу до конца Раунда и осталось непотреблённым, попросту сгорает.
  events.push({ kind: "roundEnded", round: state.round });
  const clearedSquads = state.squads.map((squad) => ({ ...squad, attackSpentOutOfTurn: false }));
  const order = initiativeOrder(clearedSquads);
  const first = order[0];
  const opener = first === undefined ? undefined : clearedSquads.find((squad) => squad.id === first);
  if (opener === undefined) throw new Error("Бой без Отрядов");
  return openTurn(opener, state.round + 1, order, 0, clearedSquads);
};

/**
 * Держатели, готовые перехватить именно ЭТО намерение провокатора — с учётом
 * исключения: если провокатор сам атакует держателя, спор решает эта атака, а
 * не Оппортун, и такой держатель из перехвата исключается.
 */
const targetsHolder = (intent: Intent, holderId: SquadId): boolean =>
  (intent.kind === "attack" || intent.kind === "rangedAttack") && intent.target === holderId;

const interceptingHolders = (state: BattleState, provokerId: SquadId, intent: Intent): readonly SquadId[] =>
  armedAgainst(state.armedThreats, provokerId).filter((holderId) => !targetsHolder(intent, holderId));

/**
 * Либо переводит Бой в Фазу Оппортуна (если намерение перехвачено), либо сразу
 * выполняет `proceed`. Вызывается только после того, как само намерение уже
 * прошло проверку на легальность — так `legalIntents` не путает отложенное
 * намерение с невозможным.
 */
const deferOrElse = (state: BattleState, provokerId: SquadId, intent: Intent, proceed: () => Applied): Applied => {
  const holders = interceptingHolders(state, provokerId, intent);
  if (holders.length === 0) return proceed();

  return {
    ok: true,
    state: { ...state, phase: { kind: "opportunity", holders, against: provokerId, deferred: intent } },
    events: [],
  };
};

const applyStep = (state: BattleState, to: Hex): Applied => {
  const squad = active(state);
  // Копейщик умеет шагнуть на свой Фланг или Тыл без разворота — вдвое дороже.
  const sideways = spearmanSidewaysFactor(squad, to);
  if (!facesHex(squad, to) && sideways === undefined) return reject("notInFront");
  if (!isPassable(state.board, to, state.season)) return reject("impassable");
  if (squadAt(state, to) !== undefined) return reject("hexOccupied");

  // Бежать разрешено только кратчайшим маршрутом к Обозу своей стороны — даже
  // если чужой край ближе: паникующий Отряд бежит домой, а не в чужой тыл.
  if (squad.routing && distanceToEdge(to, state.board, squad.side) >= distanceToEdge(squad.hex, state.board, squad.side)) {
    return reject("notShortestRoute");
  }

  const cost = stepCost(state.board, squad, squad.hex, to, state.season) * (sideways ?? 1);
  if (squad.movement < cost) return reject("noMovement");

  return deferOrElse(state, squad.id, { kind: "step", to }, () => {
    const remaining = stepEndsMovement(state.board, squad, to) ? 0 : squad.movement - cost;

    // Зимняя вода трескается под входящим Отрядом: бросок расходует зерно
    // независимо от исхода, поэтому дальше по функции `rng` заменяет `state.rng`.
    let rng = state.rng;
    if (state.season === "winter" && terrainAt(state.board, to) === "water") {
      const rolled = roll(rng, 100);
      rng = rolled.state;
      if (rolled.value <= iceCrackChancePercent(squad)) {
        const damage = Math.round(maxHealthOf(squad) * ICE_CRACK_DAMAGE_FRACTION);
        const cracked: Squad = { ...squad, movement: remaining, health: squad.health - damage };
        const events: Event[] = [{ kind: "iceCracked", squad: squad.id, hex: to, health: damage }];
        return commit(state, { ...withSquad(state, cracked, events), rng });
      }
    }

    // Разбег копится только шагами прямо вперёд: боковой шаг копейщика линию
    // разгона не продолжает.
    const chargeSteps = sideways === undefined ? squad.chargeSteps + 1 : 0;
    const moved: Squad = { ...squad, hex: to, movement: remaining, chargeSteps };
    const events: Event[] = [{ kind: "stepped", squad: squad.id, from: squad.hex, to, cost }];

    if (moved.routing && atEdge(to, state.board, moved.side)) {
      events.push({ kind: "squadLeftBoard", squad: moved.id });
      return commit(state, {
        squads: state.squads.filter((candidate) => candidate.id !== moved.id),
        departed: [...state.departed, departedFrom(moved, "routed")],
        rng,
        armedThreats: state.armedThreats,
        horses: state.horses,
        events,
      });
    }

    // Обоз своей стороны: дальнобойный Отряд, дошедший туда, пополняет
    // Боезапас. Чужой Обоз не годится — стрел там для него нет.
    const atBaggage = atEdge(to, state.board, moved.side);
    const restocked: Squad =
      atBaggage && SQUAD_TYPES[moved.type].branch === "ranged" && moved.ammo < AMMO_CAPACITY
        ? { ...moved, ammo: AMMO_CAPACITY }
        : moved;
    if (restocked !== moved) events.push({ kind: "ammoRestocked", squad: restocked.id, by: "baggage" });

    // Вход в чужую Зону провокации взводит держателю право Оппортуна — сработает
    // на самое первое намерение, которое provoker объявит следующим.
    const armed = armThreatsFor(state.board, state.squads, state.armedThreats, restocked);
    for (const holder of armed.armed) events.push({ kind: "opportunityArmed", holder, against: restocked.id });

    return commit(state, { ...withSquad(state, restocked, events), rng, armedThreats: armed.armedThreats });
  });
};

const applyRotate = (state: BattleState, facing: Facing): Applied => {
  const squad = active(state);
  if (squad.facing === facing) return reject("sameFacing");

  const free = rotationIsFree(squad);
  if (!free && squad.movement < 1) return reject("noMovement");

  return deferOrElse(state, squad.id, { kind: "rotate", facing }, () => {
    const turned: Squad = {
      ...squad,
      facing,
      movement: free ? squad.movement : squad.movement - 1,
      spent: { ...squad.spent, freeRotation: squad.spent.freeRotation || free },
      // Любой разворот обнуляет разбег.
      chargeSteps: 0,
    };
    return commit(state, withSquad(state, turned, [{ kind: "rotated", squad: squad.id, facing, free }]));
  });
};

const applySurge = (state: BattleState): Applied => {
  const squad = active(state);
  if (squad.spent.surged) return reject("alreadySurged");
  if (surgeBlocked(state.board, squad)) return reject("surgeBlocked");
  if (squad.morale < SURGE_MORALE_COST) return reject("notEnoughMorale");

  return deferOrElse(state, squad.id, { kind: "surge" }, () => {
    const surged: Squad = {
      ...squad,
      morale: squad.morale - SURGE_MORALE_COST,
      movement: squad.movement * 2,
      spent: { ...squad.spent, surged: true },
    };
    return commit(state, withSquad(state, surged, [{ kind: "surged", squad: squad.id, movement: surged.movement }]));
  });
};

/** Множители строя для Удара, приходящего указанной стороне защитника:
 *  Сомкнутый строй смягчает Фронт, копейщик уязвимее к Здоровью в Тыл. */
const formationModifiers = (
  state: BattleState,
  attacker: Squad,
  defender: Squad,
  side: "front" | "flank" | "rear",
): { modifiers: readonly number[]; healthModifiers: readonly number[] } => ({
  modifiers: [
    strikeElevationFactor(state.board, attacker, defender),
    mudWeightFactor(state.board, attacker, defender),
    ...(side === "front" ? [shieldWallFactor(state.board, state.squads, defender, state.season)] : []),
  ],
  healthModifiers: side === "rear" ? [rearVulnerabilityFactor(defender)] : [],
});

const applyAttack = (state: BattleState, targetId: SquadId): Applied => {
  const attacker = active(state);
  if (attacker.routing) return reject("routing");
  if (attacker.spent.attacked) return reject("alreadyAttacked");
  const attackerType = SQUAD_TYPES[attacker.type];
  // Дальняя атака заменяет обычную Атаку целиком — дальнобойные бьют только
  // через Навес, Прямую наводку или собственный Ближний бой.
  if (attackerType.branch === "ranged") return reject("requiresRangedAttack");

  const defender = squadById(state, targetId);
  if (defender === undefined) return reject("unknownSquad");
  if (!isEnemy(attacker, defender)) return reject("notAnEnemy");
  if (!inAttackReach(attacker, defender)) return reject("notInFront");

  return deferOrElse(state, attacker.id, { kind: "attack", target: targetId }, () => {
    const rawSide = strikeSide(attacker, defender);
    // Удар ударной пехоты в Тыл читается как удар по Флангу — особенность
    // Прорыва, а не общее правило: смягчает и Мораль, и Уязвимость копейщика.
    const side = attackerType.branch === "shock" && rawSide === "rear" ? "flank" : rawSide;
    const formation = formationModifiers(state, attacker, defender, side);
    const dealt = resolveStrike({
      attacker,
      defender,
      modifiers: formation.modifiers,
      healthModifiers: formation.healthModifiers,
      sideOverride: side,
    });
    const struck: Squad = {
      ...defender,
      health: defender.health - dealt.health,
      morale: defender.morale - dealt.morale,
    };
    const spentAttacker: Squad = { ...attacker, spent: { ...attacker.spent, attacked: true } };

    const events: Event[] = [
      {
        kind: "attacked",
        attacker: attacker.id,
        defender: defender.id,
        side: rawSide,
        health: dealt.health,
        morale: dealt.morale,
        counterattack: false,
      },
    ];

    // Контратака: только во Фронт защитника, только если удар не сломил его Мораль
    // первым. Считается от уже раненого защитника — его собственное Здоровье могло
    // упасть ниже половины этим самым Ударом, и тогда Контратака бьёт вполсилы.
    let finalAttacker = spentAttacker;
    let finalDefender = struck;
    if (side === "front" && struck.morale > 0) {
      const defenderType = SQUAD_TYPES[defender.type];
      const rawCounterSide = strikeSide(struck, attacker);
      const counterSide = defenderType.branch === "shock" && rawCounterSide === "rear" ? "flank" : rawCounterSide;
      const counterFormation = formationModifiers(state, struck, attacker, counterSide);
      const returned = resolveStrike({
        attacker: struck,
        defender: attacker,
        modifiers: counterFormation.modifiers,
        healthModifiers: counterFormation.healthModifiers,
        sideOverride: counterSide,
      });
      finalAttacker = {
        ...spentAttacker,
        health: spentAttacker.health - returned.health,
        morale: spentAttacker.morale - returned.morale,
      };
      finalDefender = state.policies.counterattackSpendsDefendersAttack
        ? { ...struck, attackSpentOutOfTurn: true }
        : struck;

      events.push({
        kind: "attacked",
        attacker: defender.id,
        defender: attacker.id,
        side: rawCounterSide,
        health: returned.health,
        morale: returned.morale,
        counterattack: true,
      });
    }

    // Отражение Сомкнутого строя: копейщик возвращает разогнавшейся кавалерии
    // её же урон. Атакой не считается, поэтому идёт независимо от Контратаки и
    // переживает Бегство отражающего — в отличие от неё.
    if (reflectsCharge(state.board, state.squads, defender, side, isCharging(attacker), state.season)) {
      finalAttacker = { ...finalAttacker, health: finalAttacker.health - dealt.health };
      events.push({
        kind: "chargeReflected",
        reflector: defender.id,
        attacker: attacker.id,
        health: dealt.health,
      });
    }

    // Исключение "атака по держателю" не вызывает саму Фазу Оппортуна, но право
    // всё равно решено этой атакой — оставлять его висеть в armedThreats нельзя.
    const armedThreats = state.armedThreats.filter(
      (threat) => !(threat.holder === defender.id && threat.against === attacker.id),
    );

    const committed = commit(state, {
      squads: state.squads.map((squad) =>
        squad.id === attacker.id ? finalAttacker : squad.id === defender.id ? finalDefender : squad,
      ),
      departed: state.departed,
      rng: state.rng,
      armedThreats,
      horses: scareHorses(state.horses, [attacker.hex, defender.hex], events),
      events,
    });

    // Прорыв: только ударная пехота, только если Бой продолжается и цель ещё на
    // доске. "Совокупный урон союзников" читаем как всё отнятое Здоровье цели —
    // в этой системе лечения нет, так что это одно и то же число.
    if (!committed.ok || committed.state.phase.kind !== "turn") return committed;
    if (attackerType.branch !== "shock") return committed;
    const survivor = squadById(committed.state, defender.id);
    if (survivor === undefined) return committed;

    const healthLost = maxHealthOf(survivor) - survivor.health;
    const survivorNaturalDamage = scaleToHeadcount(SQUAD_TYPES[survivor.type].damage, survivor.headcount);
    if (healthLost < survivorNaturalDamage) return committed;

    return {
      ...committed,
      state: { ...committed.state, phase: { kind: "breakthrough", attacker: attacker.id, target: defender.id } },
    };
  });
};

const applyRangedAttack = (state: BattleState, targetId: SquadId, mode: RangedMode): Applied => {
  const attacker = active(state);
  if (attacker.routing) return reject("routing");
  if (attacker.spent.attacked) return reject("alreadyAttacked");

  const type = SQUAD_TYPES[attacker.type];
  if (type.branch !== "ranged") return reject("notRanged");
  if (attacker.ammo <= 0) return reject("outOfAmmo");
  if (attacker.rangedCooldown > 0) return reject("reloading");
  if (mode === "arcShot" && type.forbidsArcShot) return reject("modeForbidden");

  const defender = squadById(state, targetId);
  if (defender === undefined) return reject("unknownSquad");
  if (!isEnemy(attacker, defender)) return reject("notAnEnemy");

  if (mode === "arcShot") {
    if (!arcReach(state.board, attacker).some((hex) => sameHex(hex, defender.hex))) return reject("outOfRange");
    if (TERRAIN[terrainAt(state.board, defender.hex)].immuneToArcShot) return reject("immuneToArcShot");
  } else if (mode === "directShot") {
    const line = directLines(state.board, attacker).find((candidate) => sameHex(candidate.target, defender.hex));
    if (line === undefined) return reject("outOfRange");
    if (forestBlocksLine(state.board, line)) return reject("lineBlocked");
    if (blockingSquad(state.board, state.squads, attacker, line) !== undefined) return reject("lineBlocked");
  } else if (!meleeShotReach(attacker).some((hex) => sameHex(hex, defender.hex))) {
    return reject("outOfRange");
  }

  return deferOrElse(state, attacker.id, { kind: "rangedAttack", target: targetId, mode }, () => {
    const side = strikeSide(attacker, defender);
    const terrainFactor = TERRAIN[terrainAt(state.board, defender.hex)].rangedDamageFactor;
    const dealt = resolveRangedStrike({ attacker, defender, mode, terrainFactor });

    const struck: Squad = {
      ...defender,
      health: defender.health - dealt.health,
      morale: defender.morale - dealt.morale,
    };

    // Ближний бой — единственный режим, где стрелок расплачивается сам: он
    // получает моральный самоурон, независимо от того, что досталось цели.
    const selfMorale = mode === "meleeShot" ? meleeShotSelfMorale(attacker) : undefined;
    const spentAttacker: Squad = {
      ...attacker,
      morale: selfMorale === undefined ? attacker.morale : attacker.morale - selfMorale,
      ammo: attacker.ammo - 1,
      rangedCooldown: type.attacksEveryOtherTurn ? RELOAD_COOLDOWN : attacker.rangedCooldown,
      spent: { ...attacker.spent, attacked: true },
    };

    const rangedEvents: Event[] = [
      {
        kind: "rangedAttacked",
        attacker: attacker.id,
        defender: defender.id,
        mode,
        side,
        health: dealt.health,
        morale: dealt.morale,
        ...(selfMorale === undefined ? {} : { selfMorale }),
      },
    ];

    // Гексы, над которыми прошёл выстрел: только Прямая наводка идёт по земле
    // и способна спугнуть коней по дороге — Навес летит поверх.
    const pathHexes: readonly Hex[] =
      mode === "directShot"
        ? (directLines(state.board, attacker).find((candidate) => sameHex(candidate.target, defender.hex))?.through ?? [])
        : [];

    // То же исключение, что и у обычной Атаки: если стрелок бьёт держателя,
    // висящее против него право Оппортуна снимается этой самой атакой.
    const armedThreats = state.armedThreats.filter(
      (threat) => !(threat.holder === defender.id && threat.against === attacker.id),
    );

    return commit(state, {
      squads: state.squads.map((squad) =>
        squad.id === attacker.id ? spentAttacker : squad.id === defender.id ? struck : squad,
      ),
      departed: state.departed,
      rng: state.rng,
      armedThreats,
      horses: scareHorses(state.horses, [attacker.hex, defender.hex, ...pathHexes], rangedEvents),
      events: rangedEvents,
    });
  });
};

/** Снабжает союзный дальнобойный Отряд Боезапасом. Не архер — теряет свою
 *  Атаку в этом Ходу; архер продолжает стрелять как обычно. */
const applyResupply = (state: BattleState, targetId: SquadId): Applied => {
  const supplier = active(state);
  if (supplier.routing) return reject("routing");

  const target = squadById(state, targetId);
  if (target === undefined) return reject("unknownSquad");
  if (target.side !== supplier.side || target.id === supplier.id) return reject("cannotResupply");
  if (SQUAD_TYPES[target.type].branch !== "ranged") return reject("cannotResupply");
  if (distance(supplier.hex, target.hex) !== 1) return reject("outOfRange");
  if (supplier.resuppliedCount >= RESUPPLY_LIMIT) return reject("cannotResupply");

  return deferOrElse(state, supplier.id, { kind: "resupply", target: targetId }, () => {
    const restockedTarget: Squad = { ...target, ammo: AMMO_CAPACITY };
    const spentSupplier: Squad = {
      ...supplier,
      resuppliedCount: supplier.resuppliedCount + 1,
      spent: supplier.type === "archer" ? supplier.spent : { ...supplier.spent, attacked: true },
    };

    return commit(state, {
      squads: state.squads.map((squad) =>
        squad.id === supplier.id ? spentSupplier : squad.id === target.id ? restockedTarget : squad,
      ),
      departed: state.departed,
      rng: state.rng,
      armedThreats: state.armedThreats,
      horses: state.horses,
      events: [{ kind: "ammoRestocked", squad: target.id, by: "resupply" }],
    });
  });
};

/**
 * Цепочка Гексов от `origin` в направлении `direction`: сколько Отрядов подряд
 * стоят друг за другом, и первый свободный проходимый Гекс за ними — туда
 * сдвигается вся цепочка. `undefined`, если цепочка упирается в непроходимое
 * до того, как находится свободное место.
 */
const resolveChain = (
  state: BattleState,
  origin: Hex,
  direction: Facing,
): { readonly chain: readonly Squad[]; readonly landing: Hex } | undefined => {
  const chain: Squad[] = [];
  let hex = origin;
  for (let guard = 0; guard < 32; guard++) {
    const occupant = squadAt(state, hex);
    if (occupant === undefined) return { chain, landing: hex };
    chain.push(occupant);
    const next = neighbour(hex, direction);
    if (!isPassable(state.board, next, state.season)) return undefined;
    hex = next;
  }
  return undefined;
};

/**
 * Прорыв: цель отодвигается по линии атаки (её "Тыл" в смысле статьи — Гекс,
 * продолжающий направление удара), утаскивая цепочкой всех, кто стоит следом.
 * Если этот путь недоступен — доступный Гекс сначала Фланга, потом Фронта
 * цели, без цепочки. Ничего не подошло — Прорыв не срабатывает.
 */
const resolveBreakthrough = (
  state: BattleState,
  attacker: Squad,
  target: Squad,
): { readonly squads: readonly Squad[]; readonly events: readonly Event[] } | undefined => {
  const primary = resolveChain(state, target.hex, attacker.facing);
  if (primary !== undefined) {
    const newHexOf = new Map<SquadId, Hex>();
    primary.chain.forEach((squad, index) => {
      const next = primary.chain[index + 1];
      newHexOf.set(squad.id, next !== undefined ? next.hex : primary.landing);
    });
    newHexOf.set(attacker.id, target.hex);

    const squads = state.squads.map((squad) => {
      const next = newHexOf.get(squad.id);
      return next === undefined ? squad : { ...squad, hex: next };
    });
    return {
      squads,
      events: [
        { kind: "breakthroughPushed", attacker: attacker.id, target: target.id, chain: primary.chain.map((s) => s.id) },
      ],
    };
  }

  const fallback = [...sides(target.hex, target.facing).flank, ...sides(target.hex, target.facing).front];
  const empty = fallback.find((hex) => isPassable(state.board, hex, state.season) && squadAt(state, hex) === undefined);
  if (empty === undefined) return undefined;

  const squads = state.squads.map((squad) => {
    if (squad.id === target.id) return { ...squad, hex: empty };
    if (squad.id === attacker.id) return { ...squad, hex: target.hex };
    return squad;
  });
  return {
    squads,
    events: [{ kind: "breakthroughPushed", attacker: attacker.id, target: target.id, chain: [target.id] }],
  };
};

/** Логирует события и меняет Фазу, не трогая Отряды — для исходов Прорыва, где
 *  сдвигать нечего (отказ или неудача). */
const logOnly = (state: BattleState, phase: BattleState["phase"], events: readonly Event[]): Applied => ({
  ok: true,
  state: { ...state, phase, log: [...state.log, ...events] },
  events,
});

/** Ответ на предложение Прорыва: отодвинуть цель или оставить как есть. */
const applyBreakthroughResponse = (state: BattleState, push: boolean): Applied => {
  if (state.phase.kind !== "breakthrough") return reject("wrongPhase");
  const { attacker: attackerId, target: targetId } = state.phase;
  const backToTurn = { kind: "turn" as const, squad: attackerId };

  if (!push) {
    return logOnly(state, backToTurn, [{ kind: "breakthroughDeclined", attacker: attackerId, target: targetId }]);
  }

  const attacker = squadById(state, attackerId);
  const target = squadById(state, targetId);
  if (attacker === undefined || target === undefined) {
    return logOnly(state, backToTurn, []);
  }

  const resolved = resolveBreakthrough(state, attacker, target);
  if (resolved === undefined) {
    return logOnly(state, backToTurn, [{ kind: "breakthroughFailed", attacker: attackerId, target: targetId }]);
  }

  return commit(
    { ...state, phase: backToTurn },
    {
      squads: resolved.squads,
      departed: state.departed,
      rng: state.rng,
      armedThreats: state.armedThreats,
      horses: state.horses,
      events: [...resolved.events],
    },
  );
};

/** Спешивание: кавалерия становится аналогичной пехотой, оставляя коней. */
const applyDismount = (state: BattleState): Applied => {
  const squad = active(state);
  if (squad.routing) return reject("routing");
  const becomes = SQUAD_TYPES[squad.type].dismountsTo;
  if (becomes === undefined) return reject("cannotDismount");
  if (squad.movement < MOUNT_MOVEMENT_COST) return reject("noMovement");

  return deferOrElse(state, squad.id, { kind: "dismount" }, () => {
    const dismounted: Squad = {
      ...squad,
      ...convertTo(squad, becomes),
      movement: squad.movement - MOUNT_MOVEMENT_COST,
      // Пеший Отряд разбег не сохраняет.
      chargeSteps: 0,
    };

    return commit(state, {
      ...withSquad(state, dismounted, [
        { kind: "dismounted", squad: squad.id, becomes, hex: squad.hex },
      ]),
      horses: [...state.horses, { hex: squad.hex, side: squad.side, mountsTo: squad.type }],
    });
  });
};

/** Седлание: пехота поднимает коней со своего Гекса и становится кавалерией. */
const applyMount = (state: BattleState): Applied => {
  const squad = active(state);
  if (squad.routing) return reject("routing");
  if (squad.movement < MOUNT_MOVEMENT_COST) return reject("noMovement");

  const horses = state.horses.find(
    (candidate) => sameHex(candidate.hex, squad.hex) && candidate.side === squad.side,
  );
  if (horses === undefined) return reject("noHorses");

  // Оседлать можно только тех коней, что соответствуют этому Типу пехоты:
  // «отряд копейщиков, оседлавший коней, становится кавалерией».
  const becomes = SQUAD_TYPES[squad.type].mountsTo;
  if (becomes === undefined || becomes !== horses.mountsTo) return reject("cannotDismount");

  return deferOrElse(state, squad.id, { kind: "mount" }, () => {
    const mounted: Squad = {
      ...squad,
      ...convertTo(squad, becomes),
      movement: squad.movement - MOUNT_MOVEMENT_COST,
      // «...становится кавалерией, но его ранг понижается до I».
      rank: 1,
      chargeSteps: 0,
    };

    return commit(state, {
      ...withSquad(state, mounted, [{ kind: "mounted", squad: squad.id, becomes }]),
      horses: state.horses.filter((candidate) => candidate !== horses),
    });
  });
};

/** Сторона активного Отряда снимает Бой с себя. Оппортуну не подчиняется —
 *  это административное действие, а не Ход по правилам статьи. */
const applyConcede = (state: BattleState): Applied => {
  const squad = active(state);
  return finish(
    state,
    { squads: state.squads, departed: state.departed, rng: state.rng, armedThreats: state.armedThreats, horses: state.horses, events: [] },
    sideOpposing(squad.side),
  );
};

const applyEndTurn = (state: BattleState): Applied => {
  const squad = active(state);
  return deferOrElse(state, squad.id, { kind: "endTurn" }, () => advanceTurn(state));
};

/**
 * Один ответ держателя в Фазе Оппортуна. Держатели отвечают по очереди — этот
 * вызов обрабатывает голову списка и либо передаёт очередь дальше, либо, если
 * это был последний держатель, исполняет отложенное намерение провокатора.
 */
const applyOpportunityResponse = (state: BattleState, strike: boolean): Applied => {
  if (state.phase.kind !== "opportunity") return reject("wrongPhase");
  const { holders, against, deferred } = state.phase;
  const holderId = holders[0];
  if (holderId === undefined) throw new Error("Фаза Оппортуна без держателей");

  const armedThreats = state.armedThreats.filter(
    (threat) => !(threat.holder === holderId && threat.against === against),
  );

  const holder = squadById(state, holderId);
  const target = squadById(state, against);
  let squads = state.squads;
  const events: Event[] = [];

  if (strike && holder !== undefined && target !== undefined) {
    // Оппортун не провоцирует встречную Контратаку: провокатор застигнут
    // посреди своего намерения, а не сам объявляет атаку.
    const holderType = SQUAD_TYPES[holder.type];
    const side = strikeSide(holder, target);
    const isRanged = holderType.branch === "ranged";
    const dealt = isRanged
      ? resolveRangedStrike({
          attacker: holder,
          defender: target,
          mode: "arcShot",
          terrainFactor: TERRAIN[terrainAt(state.board, target.hex)].rangedDamageFactor,
        })
      : resolveStrike({ attacker: holder, defender: target });

    const struckTarget: Squad = { ...target, health: target.health - dealt.health, morale: target.morale - dealt.morale };
    const spentHolder: Squad = {
      ...holder,
      spent: { ...holder.spent, attacked: true },
      // Статья: «атаковавший оппортуном считается отходившим». Списание обязано
      // дожить до собственного Хода держателя, а не сгореть вместе с чужим.
      attackSpentOutOfTurn: true,
      ammo: isRanged ? holder.ammo - 1 : holder.ammo,
      rangedCooldown: isRanged && holderType.attacksEveryOtherTurn ? RELOAD_COOLDOWN : holder.rangedCooldown,
    };

    squads = squads.map((squad) => (squad.id === holder.id ? spentHolder : squad.id === target.id ? struckTarget : squad));
    events.push({ kind: "opportunityStrike", holder: holder.id, against: target.id, side, health: dealt.health, morale: dealt.morale });
  } else {
    events.push({ kind: "opportunityDeclined", holder: holderId, against });
  }

  const settled = settle({
    squads,
    departed: state.departed,
    rng: state.rng,
    armedThreats,
    horses: strike && holder !== undefined && target !== undefined ? scareHorses(state.horses, [holder.hex, target.hex], events) : state.horses,
    events,
  });
  const left = standingSides(settled.squads);
  if (left.length <= 1) return finish(state, settled, left[0] ?? null);

  const nextState: BattleState = {
    ...state,
    squads: settled.squads,
    departed: settled.departed,
    rng: settled.rng,
    armedThreats: settled.armedThreats,
    horses: settled.horses,
    log: [...state.log, ...settled.events],
  };

  const remainingHolders = holders.slice(1);
  const provoker = squadById(nextState, against);

  // Отложенное намерение не исполняется, если провокатор уничтожен этим самым
  // ответом: остальные держатели бьют уже некого, их права просто сгорают.
  if (provoker === undefined) {
    return advanceTurn({ ...nextState, phase: { kind: "turn", squad: against } });
  }

  if (remainingHolders.length > 0) {
    return {
      ok: true,
      state: { ...nextState, phase: { kind: "opportunity", holders: remainingHolders, against, deferred } },
      events: settled.events,
    };
  }

  // Провокатор сломлен этим же ударом: отложенное намерение тоже не исполняется,
  // а его Ход продолжается уже по правилам Бегства.
  if (provoker.routing) {
    return { ok: true, state: { ...nextState, phase: { kind: "rout", squad: against } }, events: settled.events };
  }

  // Отложенное намерение могло стать незаконным именно из-за этого Удара
  // (скажем, Ускорение после просевшей Морали). Тогда оно просто не
  // исполняется — но Удар держателя обязан остаться в состоянии, а не
  // откатиться вместе с отказом.
  const resumed: BattleState = { ...nextState, phase: { kind: "turn", squad: against } };
  const executed = executeIntent(resumed, deferred);
  return executed.ok ? executed : { ok: true, state: resumed, events: settled.events };
};

/** Диспетчер намерений внутри одного Хода — общий для прямого вызова и для
 *  исполнения намерения, отложенного и пережившего Фазу Оппортуна. */
const executeIntent = (state: BattleState, intent: Intent): Applied => {
  // Атака завершает Ход — но Маневренность снимает с кавалерии именно запрет на
  // перемещение, оставляя запрет на второй Удар (он проверяется в самих
  // обработчиках Атаки).
  const movementIntent = intent.kind === "step" || intent.kind === "rotate" || intent.kind === "surge";
  const actor = active(state);
  if (intent.kind !== "endTurn" && actor.spent.attacked) {
    // Атака, списанная Оппортуном на чужом Ходу, оставляет право развернуться:
    // «после удара он может только развернуться в нужное направление».
    const mayTurn = intent.kind === "rotate" && actor.spent.attackedOutOfTurn;
    if (!mayTurn && !(movementIntent && hasMobility(actor))) return reject("alreadyAttacked");
  }

  switch (intent.kind) {
    case "step":
      return applyStep(state, intent.to);
    case "rotate":
      return applyRotate(state, intent.facing);
    case "surge":
      return applySurge(state);
    case "attack":
      return applyAttack(state, intent.target);
    case "rangedAttack":
      return applyRangedAttack(state, intent.target, intent.mode);
    case "resupply":
      return applyResupply(state, intent.target);
    case "dismount":
      return applyDismount(state);
    case "mount":
      return applyMount(state);
    case "concede":
      return applyConcede(state);
    case "endTurn":
      return applyEndTurn(state);
    case "opportunity":
      return reject("wrongPhase");
    case "breakthrough":
      return reject("wrongPhase");
  }
};

/** Единственный вход, меняющий состояние Боя. */
export const apply = (state: BattleState, intent: Intent): Applied => {
  if (state.phase.kind === "over") return reject("battleOver");
  if (state.phase.kind === "opportunity") {
    return intent.kind === "opportunity" ? applyOpportunityResponse(state, intent.strike) : reject("wrongPhase");
  }
  if (state.phase.kind === "breakthrough") {
    return intent.kind === "breakthrough" ? applyBreakthroughResponse(state, intent.push) : reject("wrongPhase");
  }
  if (intent.kind === "opportunity" || intent.kind === "breakthrough") return reject("wrongPhase");

  return executeIntent(state, intent);
};

/** Намерения, законные в текущей Фазе. UI обязан брать их отсюда, а не вычислять сам. */
export const legalIntents = (state: BattleState): readonly Intent[] => {
  if (state.phase.kind === "over") return [];
  if (state.phase.kind === "opportunity") {
    return [{ kind: "opportunity", strike: true }, { kind: "opportunity", strike: false }];
  }
  if (state.phase.kind === "breakthrough") {
    return [{ kind: "breakthrough", push: true }, { kind: "breakthrough", push: false }];
  }

  const squad = active(state);
  const legal: Intent[] = [];

  for (const to of sides(squad.hex, squad.facing).front) {
    if (apply(state, { kind: "step", to }).ok) legal.push({ kind: "step", to });
  }
  for (const facing of FACINGS) {
    if (apply(state, { kind: "rotate", facing }).ok) legal.push({ kind: "rotate", facing });
  }
  if (apply(state, { kind: "surge" }).ok) legal.push({ kind: "surge" });
  if (apply(state, { kind: "dismount" }).ok) legal.push({ kind: "dismount" });
  if (apply(state, { kind: "mount" }).ok) legal.push({ kind: "mount" });

  const modes: readonly RangedMode[] = ["arcShot", "directShot", "meleeShot"];
  for (const candidate of state.squads) {
    const attack: Intent = { kind: "attack", target: candidate.id };
    if (apply(state, attack).ok) legal.push(attack);

    for (const mode of modes) {
      const rangedAttack: Intent = { kind: "rangedAttack", target: candidate.id, mode };
      if (apply(state, rangedAttack).ok) legal.push(rangedAttack);
    }

    const resupply: Intent = { kind: "resupply", target: candidate.id };
    if (apply(state, resupply).ok) legal.push(resupply);
  }

  legal.push({ kind: "concede" }, { kind: "endTurn" });
  return legal;
};
