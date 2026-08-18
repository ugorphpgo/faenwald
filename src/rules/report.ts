import { scaleToHeadcount } from "./scale.ts";
import { SQUAD_TYPES } from "./catalog/squad-types.ts";
import type { Side, Squad, SquadId } from "./state.ts";

/** Чем закончил Отряд. */
export type Fate = "destroyed" | "routed" | "survived";

export type SquadOutcome = {
  readonly squad: SquadId;
  readonly side: Side;
  readonly fate: Fate;
  /** Безвозвратно выбывшие солдаты. */
  readonly casualties: number;
};

export type BattleReport = {
  /** Победившая сторона; `null` — обе стороны кончились одновременно. */
  readonly winner: Side | null;
  readonly rounds: number;
  readonly squads: readonly SquadOutcome[];
  readonly casualtiesBySide: Readonly<Record<Side, number>>;
};

/** Отряд, покинувший доску: уничтоженный или добежавший до края. */
export type Departed = {
  readonly squad: SquadId;
  readonly side: Side;
  readonly fate: Exclude<Fate, "survived">;
  readonly headcount: number;
  /** Доля отнятого Здоровья на момент ухода, от нуля до единицы. */
  readonly healthLost: number;
};

/**
 * Потери: половина отнятого Здоровья, если Отряд ушёл с поля живым, и весь Отряд,
 * если не ушёл. Статья: «если ваш отряд за время боя лишился половины здоровья — вы
 * потеряли четверть отряда».
 */
export const casualtiesOf = (headcount: number, healthLost: number, fate: Fate): number =>
  fate === "destroyed" ? headcount : Math.round(headcount * healthLost * 0.5);

const healthLostFraction = (squad: Squad): number => {
  const max = scaleToHeadcount(SQUAD_TYPES[squad.type].health, squad.headcount);
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, (max - squad.health) / max));
};

export const buildReport = (
  onBoard: readonly Squad[],
  departed: readonly Departed[],
  rounds: number,
  winner: Side | null,
): BattleReport => {
  const outcomes: SquadOutcome[] = [
    ...departed.map((entry) => ({
      squad: entry.squad,
      side: entry.side,
      fate: entry.fate,
      casualties: casualtiesOf(entry.headcount, entry.healthLost, entry.fate),
    })),
    ...onBoard.map((squad) => ({
      squad: squad.id,
      side: squad.side,
      fate: "survived" as const,
      casualties: casualtiesOf(squad.headcount, healthLostFraction(squad), "survived"),
    })),
  ];

  const casualtiesBySide = { blue: 0, red: 0 };
  for (const outcome of outcomes) casualtiesBySide[outcome.side] += outcome.casualties;

  return { winner, rounds, squads: outcomes, casualtiesBySide };
};

export const departedFrom = (squad: Squad, fate: Exclude<Fate, "survived">): Departed => ({
  squad: squad.id,
  side: squad.side,
  fate,
  headcount: squad.headcount,
  healthLost: healthLostFraction(squad),
});
