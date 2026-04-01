import { Logger } from "@perf-profiler/logger";
import { NavigationEvent } from "@perf-profiler/types";

const TPN_PREFIX = "[FLASHLIGHT_TPN]";

export interface TPNStartEvent {
  event: "nav_start";
  from: string;
  to: string;
  timestamp: number;
}

export interface TPNEndEvent {
  event: "nav_end";
  to: string;
  timestamp: number;
}

export type TPNEvent = TPNStartEvent | TPNEndEvent;

export const parseTPNLine = (line: string): TPNEvent | null => {
  const prefixIndex = line.indexOf(TPN_PREFIX);
  if (prefixIndex === -1) return null;

  const jsonStr = line.slice(prefixIndex + TPN_PREFIX.length).trim();
  try {
    return JSON.parse(jsonStr) as TPNEvent;
  } catch {
    Logger.debug(`Failed to parse TPN event: ${jsonStr}`);
    return null;
  }
};

export const matchNavigationPairs = (events: TPNEvent[]): NavigationEvent[] => {
  const results: NavigationEvent[] = [];
  let pendingStart: TPNStartEvent | null = null;

  for (const event of events) {
    if (event.event === "nav_start") {
      pendingStart = event;
    } else if (event.event === "nav_end" && pendingStart && pendingStart.to === event.to) {
      results.push({
        from: pendingStart.from,
        to: event.to,
        startTime: pendingStart.timestamp,
        endTime: event.timestamp,
        duration: event.timestamp - pendingStart.timestamp,
      });
      pendingStart = null;
    }
  }

  return results;
};
