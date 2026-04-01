import { Logger } from "@perf-profiler/logger";
import { NavigationEvent } from "@perf-profiler/types";
import { executeAsync, executeCommand } from "../shell";
import { ChildProcess } from "child_process";

const TPN_PREFIX = "[FLASHLIGHT_TPN]";

interface TPNStartEvent {
  event: "nav_start";
  from: string;
  to: string;
  timestamp: number;
}

interface TPNEndEvent {
  event: "nav_end";
  to: string;
  timestamp: number;
}

type TPNEvent = TPNStartEvent | TPNEndEvent;

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

export class NavigationEventCollector {
  private process: ChildProcess | null = null;
  private pendingEvents: TPNEvent[] = [];
  private completedEvents: NavigationEvent[] = [];

  start(): void {
    // Clear logcat buffer so we only get live events, not historical ones
    try {
      executeCommand("adb logcat -c");
    } catch {
      // ignore if clear fails
    }
    this.process = executeAsync("adb logcat -s ReactNativeJS:*", { logStderr: false });

    this.process.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        const event = parseTPNLine(line);
        if (event) {
          Logger.info(`TPN event received: ${JSON.stringify(event)}`);
          this.pendingEvents.push(event);
          const matched = matchNavigationPairs(this.pendingEvents);
          if (matched.length > 0) {
            Logger.info(`TPN navigation matched: ${JSON.stringify(matched)}`);
            this.completedEvents.push(...matched);
            this.pendingEvents = [];
          }
        }
      }
    });
  }

  flush(): NavigationEvent[] {
    const events = this.completedEvents;
    this.completedEvents = [];
    return events;
  }

  stop(): void {
    this.process?.kill("SIGINT");
    this.process = null;
    this.pendingEvents = [];
    this.completedEvents = [];
  }
}
