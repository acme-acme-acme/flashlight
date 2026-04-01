import { Logger } from "@perf-profiler/logger";
import { NavigationEvent } from "@perf-profiler/types";
import { parseTPNLine, matchNavigationPairs, TPNEvent } from "@perf-profiler/tpn";
import http from "http";

const METRO_PORT = 8081;

/**
 * Collects TPN events from Metro bundler's log output.
 * React Native's console.log goes through Metro, which exposes logs via HTTP.
 * We poll Metro's /message endpoint for log messages containing [FLASHLIGHT_TPN].
 */
export class MetroLogCollector {
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private pendingEvents: TPNEvent[] = [];
  private completedEvents: NavigationEvent[] = [];
  private port: number;

  constructor(port = METRO_PORT) {
    this.port = port;
  }

  start(): void {
    Logger.info(`Metro TPN: connecting to Metro on port ${this.port}`);

    // Poll Metro's log endpoint for TPN events
    // Metro streams logs via WebSocket, but we can also get them from the device log
    // Since we can't easily use WebSocket without a dependency, we'll use a raw HTTP connection
    // to Metro's /events endpoint which streams Server-Sent Events
    this.connectToMetroEvents();
  }

  private connectToMetroEvents(): void {
    const req = http.get(
      {
        hostname: "localhost",
        port: this.port,
        path: "/events",
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        Logger.info(`Metro TPN: connected to Metro events stream (status ${res.statusCode})`);

        res.on("data", (data: Buffer) => {
          const lines = data.toString().split(/\r?\n/);
          for (const line of lines) {
            // SSE format: data: {...json...}
            if (line.startsWith("data: ")) {
              try {
                const eventData = JSON.parse(line.slice(6));
                // Metro log events have type "client_log" with data array
                if (eventData.type === "client_log" && Array.isArray(eventData.data)) {
                  for (const logEntry of eventData.data) {
                    const message =
                      typeof logEntry === "string" ? logEntry : JSON.stringify(logEntry);
                    this.processLogLine(message);
                  }
                }
              } catch {
                // Not JSON or not a log event — check raw line for TPN
                this.processLogLine(line);
              }
            } else {
              // Also check non-SSE lines
              this.processLogLine(line);
            }
          }
        });

        res.on("error", (error) => {
          Logger.debug(`Metro TPN: stream error: ${error.message}`);
        });

        res.on("end", () => {
          Logger.debug("Metro TPN: stream ended, reconnecting...");
          // Reconnect after a delay
          setTimeout(() => this.connectToMetroEvents(), 1000);
        });
      }
    );

    req.on("error", (error) => {
      Logger.debug(`Metro TPN: connection error: ${error.message}. Metro may not be running.`);
    });
  }

  private processLogLine(line: string): void {
    const event = parseTPNLine(line);
    if (event) {
      Logger.info(`Metro TPN event received: ${JSON.stringify(event)}`);
      this.pendingEvents.push(event);
      const matched = matchNavigationPairs(this.pendingEvents);
      if (matched.length > 0) {
        Logger.info(`Metro TPN navigation matched: ${JSON.stringify(matched)}`);
        this.completedEvents.push(...matched);
        this.pendingEvents = [];
      }
    }
  }

  flush(): NavigationEvent[] {
    const events = this.completedEvents;
    this.completedEvents = [];
    return events;
  }

  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.pendingEvents = [];
    this.completedEvents = [];
  }
}
