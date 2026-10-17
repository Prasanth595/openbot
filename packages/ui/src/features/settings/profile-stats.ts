import type { AgentSummary, HostAnalytics } from "@openbot/contracts/ipc";
import { usageProviders } from "../usage/usage-format";

const DAY_MS = 86_400_000;

export interface ProfileDay {
  /** `YYYY-MM-DD` in the report's time zone. */
  date: string;
  /** 0 is Sunday. */
  weekday: number;
  tokens: number;
  messages: number;
}

export interface ProfileStats {
  days: ProfileDay[];
  tokens: number;
  messages: number;
  cost: number | null;
  activeDays: number;
  peak: ProfileDay | null;
  currentStreak: number;
  /** The first day of the current streak. */
  currentStreakStart: string | null;
  longestStreak: number;
  longestStreakDates: { start: string; end: string } | null;
  busiestWeekday: number | null;
  providers: Array<{ provider: string; tokens: number; share: number }>;
  models: Array<{ provider: string; model: string; share: number }>;
  teammates: Array<{ agent: AgentSummary; tokens: number }>;
}

function active(day: ProfileDay): boolean {
  return day.tokens > 0 || day.messages > 0;
}

/**
 * The Profile tab's view of one host report: every day of the range, the streaks, and the
 * rankings. A teammate that was deleted has usage but no row in `agents`, so the ranking skips it.
 */
export function profileStats(report: HostAnalytics, agents: readonly AgentSummary[]): ProfileStats {
  const byDate = new Map(report.daily.map((day) => [day.date, day]));
  const days: ProfileDay[] = [];
  const end = Date.parse(`${report.endDate}T00:00:00Z`);
  for (let time = Date.parse(`${report.startDate}T00:00:00Z`); time <= end; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const day = byDate.get(date);
    days.push({
      date,
      weekday: new Date(time).getUTCDay(),
      tokens: day?.processedTokens ?? 0,
      messages: (day?.userMessages ?? 0) + (day?.assistantMessages ?? 0),
    });
  }

  let longestStreak = 0;
  let longestStreakDates: ProfileStats["longestStreakDates"] = null;
  let run = 0;
  days.forEach((day, index) => {
    run = active(day) ? run + 1 : 0;
    if (run <= longestStreak) return;
    longestStreak = run;
    longestStreakDates = { start: days[index - run + 1]?.date ?? day.date, end: day.date };
  });
  // Today does not break the streak before the user has worked today.
  const today = days.at(-1);
  const counted = today && !active(today) ? days.slice(0, -1) : days;
  let currentStreak = 0;
  for (const day of counted.toReversed()) {
    if (!active(day)) break;
    currentStreak += 1;
  }

  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const day of days) weekdays[day.weekday] = (weekdays[day.weekday] ?? 0) + day.tokens;
  const busiest = Math.max(...weekdays);
  const tokens = report.totals.processedTokens;
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    days,
    tokens,
    messages: report.totals.userMessages + report.totals.assistantMessages,
    cost: report.totals.estimatedCostUsd,
    activeDays: days.filter(active).length,
    peak: days.reduce<ProfileDay | null>((best, day) => (day.tokens > (best?.tokens ?? 0) ? day : best), null),
    currentStreak,
    currentStreakStart: currentStreak > 0 ? (counted.at(-currentStreak)?.date ?? null) : null,
    longestStreak,
    longestStreakDates,
    busiestWeekday: busiest > 0 ? weekdays.indexOf(busiest) : null,
    providers: usageProviders(report.models)
      .map((row) => ({ provider: row.provider, tokens: row.tokens, share: tokens > 0 ? row.tokens / tokens : 0 }))
      .sort((a, b) => b.tokens - a.tokens),
    models: [...report.models]
      .sort((a, b) => b.processedTokens - a.processedTokens)
      .map((row) => ({ provider: row.provider, model: row.model, share: row.share })),
    teammates: report.agents
      .flatMap((row) => {
        const agent = agentById.get(row.agentId);
        return agent && row.processedTokens > 0 ? [{ agent, tokens: row.processedTokens }] : [];
      })
      .sort((a, b) => b.tokens - a.tokens),
  };
}
