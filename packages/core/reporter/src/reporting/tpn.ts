import { Measure, NavigationEvent, TestCaseIterationResult } from "@perf-profiler/types";

const collectAllEvents = (measures: Measure[]): NavigationEvent[] =>
  measures.flatMap((m) => m.tpn ?? []);

export const getAverageNavigationTime = (measures: Measure[]): number | undefined => {
  const events = collectAllEvents(measures);
  if (events.length === 0) return undefined;
  return events.reduce((sum, e) => sum + e.duration, 0) / events.length;
};

export const getSlowestNavigations = (measures: Measure[], limit = 5): NavigationEvent[] => {
  const events = collectAllEvents(measures);
  return [...events].sort((a, b) => b.duration - a.duration).slice(0, limit);
};

export interface RoutePairStats {
  average: number;
  min: number;
  max: number;
  count: number;
}

export const getNavigationStats = (
  iterations: TestCaseIterationResult[]
): Record<string, RoutePairStats> => {
  const byRoute: Record<string, number[]> = {};

  for (const iteration of iterations) {
    const events = collectAllEvents(iteration.measures);
    for (const event of events) {
      const key = `${event.from} -> ${event.to}`;
      if (!byRoute[key]) byRoute[key] = [];
      byRoute[key].push(event.duration);
    }
  }

  const stats: Record<string, RoutePairStats> = {};
  for (const [key, durations] of Object.entries(byRoute)) {
    const sum = durations.reduce((a, b) => a + b, 0);
    stats[key] = {
      average: sum / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      count: durations.length,
    };
  }

  return stats;
};
