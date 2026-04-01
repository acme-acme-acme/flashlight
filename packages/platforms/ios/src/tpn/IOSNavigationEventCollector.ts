import { Logger } from "@perf-profiler/logger";
import { NavigationEvent } from "@perf-profiler/types";
import { parseTPNLine, matchNavigationPairs, TPNEvent } from "@perf-profiler/tpn";
import { ChildProcess, exec } from "child_process";

export type IOSDeviceType = "simulator" | "device";

export class IOSNavigationEventCollector {
  private process: ChildProcess | null = null;
  private pendingEvents: TPNEvent[] = [];
  private completedEvents: NavigationEvent[] = [];
  private deviceType: IOSDeviceType;

  constructor(deviceType: IOSDeviceType) {
    this.deviceType = deviceType;
  }

  start(): void {
    const command =
      this.deviceType === "simulator"
        ? `xcrun simctl spawn booted log stream --predicate 'subsystem == "com.facebook.react.log"'`
        : "pyidevice syslog";

    this.process = exec(command);

    this.process.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        const event = parseTPNLine(line);
        if (event) {
          Logger.info(`iOS TPN event received: ${JSON.stringify(event)}`);
          this.pendingEvents.push(event);
          const matched = matchNavigationPairs(this.pendingEvents);
          if (matched.length > 0) {
            Logger.info(`iOS TPN navigation matched: ${JSON.stringify(matched)}`);
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
