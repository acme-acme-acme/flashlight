import { Logger } from "@perf-profiler/logger";
import { NavigationEvent } from "@perf-profiler/types";
import { parseTPNLine, matchNavigationPairs, TPNEvent } from "@perf-profiler/tpn";
import { executeAsync, executeCommand } from "../shell";
import { ChildProcess } from "child_process";

export { parseTPNLine, matchNavigationPairs };

export class NavigationEventCollector {
  private process: ChildProcess | null = null;
  private pendingEvents: TPNEvent[] = [];
  private completedEvents: NavigationEvent[] = [];

  start(): void {
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
