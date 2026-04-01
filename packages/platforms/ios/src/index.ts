import {
  Measure,
  POLLING_INTERVAL,
  Profiler,
  ProfilerPollingOptions,
  ScreenRecorder,
} from "@perf-profiler/types";
import { Logger } from "@perf-profiler/logger";
import { execSync } from "child_process";
import { detectIOSBundleId } from "./detectBundleId";
import { IOSNavigationEventCollector, IOSDeviceType } from "./tpn/IOSNavigationEventCollector";
import { XCTraceRecorder, detectXCTraceDeviceId } from "./xctrace/XCTraceRecorder";
import { parseTrace } from "./xctrace/XCTraceParser";

const detectDeviceType = (): IOSDeviceType => {
  try {
    const output = execSync("xcrun simctl list devices booted", { encoding: "utf-8" });
    if (output.includes("Booted")) {
      return "simulator";
    }
  } catch {
    // xcrun not available or no booted simulator
  }
  return "device";
};

const resolveSimulatorPid = (bundleId: string): number | null => {
  try {
    // Get the executable name from the bundle
    const appInfo = execSync(`xcrun simctl appinfo booted ${bundleId}`, { encoding: "utf-8" });
    const exeMatch = appInfo.match(/CFBundleExecutable\s*=\s*"?([^";\n]+)"?/);
    if (!exeMatch) {
      Logger.warn(`Could not find CFBundleExecutable for ${bundleId}`);
      return null;
    }
    const exeName = exeMatch[1].trim();

    // Find the process by executable name
    const pid = execSync(`pgrep -f "${exeName}.app/${exeName}$"`, { encoding: "utf-8" }).trim();
    if (pid) {
      Logger.info(`Resolved simulator PID for ${bundleId}: ${pid} (${exeName})`);
      return parseInt(pid, 10);
    }
  } catch (error) {
    Logger.debug(`Failed to resolve simulator PID for ${bundleId}: ${error}`);
  }
  return null;
};

export class IOSProfiler implements Profiler {
  private onMeasure: ((measure: Measure) => void) | undefined;
  private navigationCollector: IOSNavigationEventCollector | null = null;
  private deviceType: IOSDeviceType;
  private simulatorPollingInterval: ReturnType<typeof setInterval> | null = null;
  private xctraceRecorder: XCTraceRecorder | null = null;
  private currentBundleId: string | null = null;

  constructor() {
    this.deviceType = detectDeviceType();
  }

  private emitMeasure = (cpu: number, ramKb: number) => {
    const tpnEvents = this.navigationCollector?.flush() ?? [];
    if (tpnEvents.length > 0) {
      Logger.info(`iOS TPN flush: attaching ${tpnEvents.length} events to measure`);
    }

    const measure: Measure = {
      cpu: {
        perName: { Total: cpu },
        perCore: {},
      },
      ram: ramKb / 1024, // Convert KB to MiB
      fps: undefined,
      time: Date.now(),
      ...(tpnEvents.length > 0 ? { tpn: tpnEvents } : {}),
    };

    if (this.onMeasure) {
      this.onMeasure(measure);
    }
  };

  private pollSimulator(bundleId: string): { stop: () => void } {
    const pid = resolveSimulatorPid(bundleId);
    if (!pid) {
      Logger.error(
        `Could not find running process for ${bundleId}. Make sure the app is running on the simulator.`
      );
      return { stop: () => {} };
    }

    Logger.info(`iOS Simulator: polling PID ${pid} every ${POLLING_INTERVAL}ms`);

    this.simulatorPollingInterval = setInterval(() => {
      try {
        // ps -p <PID> -o %cpu=,rss= gives CPU% and RSS in KB
        const output = execSync(`ps -p ${pid} -o %cpu=,rss=`, { encoding: "utf-8" }).trim();
        if (!output) {
          Logger.debug("iOS Simulator: ps returned empty output (process may have exited)");
          return;
        }

        const parts = output.trim().split(/\s+/);
        if (parts.length >= 2) {
          const cpu = parseFloat(parts[0]);
          const rssKb = parseInt(parts[1], 10);
          Logger.debug(
            `iOS Simulator: CPU=${cpu}%, RAM=${rssKb}KB (${(rssKb / 1024).toFixed(1)} MiB)`
          );
          this.emitMeasure(cpu, rssKb);
        }
      } catch (error) {
        Logger.debug(`iOS Simulator: polling error: ${error}`);
      }
    }, POLLING_INTERVAL);

    return {
      stop: () => {
        if (this.simulatorPollingInterval) {
          clearInterval(this.simulatorPollingInterval);
          this.simulatorPollingInterval = null;
        }
      },
    };
  }

  private pollPhysicalDevice(bundleId: string): { stop: () => void } {
    const deviceId = detectXCTraceDeviceId();
    if (!deviceId) {
      Logger.error(
        "Could not detect physical iOS device for xctrace. Make sure a device is connected."
      );
      return { stop: () => {} };
    }

    this.xctraceRecorder = new XCTraceRecorder(deviceId);
    this.xctraceRecorder.start();

    Logger.info(
      `iOS Physical Device: xctrace recording started. Metrics will be available after stopping.`
    );

    return {
      stop: () => {
        if (!this.xctraceRecorder) {
          Logger.warn("iOS Physical Device: no xctrace recorder to stop");
          return;
        }

        Logger.info("iOS Physical Device: stopping xctrace recording...");
        const tracePath = this.xctraceRecorder.stop();
        Logger.info(`iOS Physical Device: trace saved to ${tracePath}`);

        // Parse the trace and emit all measures retroactively
        Logger.info(`iOS Physical Device: parsing trace for bundle ID "${bundleId}"...`);
        try {
          const measures = parseTrace(tracePath, bundleId);
          Logger.info(`iOS Physical Device: parsed ${measures.length} measures from trace`);

          if (measures.length === 0) {
            Logger.warn(
              `iOS Physical Device: no measures found for "${bundleId}". ` +
                `The app name in the trace may differ. Check xctrace export output manually.`
            );
          }

          for (const measure of measures) {
            if (this.onMeasure) {
              this.onMeasure(measure);
            }
          }
        } catch (error) {
          Logger.error(`iOS Physical Device: failed to parse trace: ${error}`);
        }

        // Clean up trace file
        this.xctraceRecorder.cleanup();
        this.xctraceRecorder = null;
      },
    };
  }

  pollPerformanceMeasures(bundleId: string, options: ProfilerPollingOptions): { stop: () => void } {
    this.onMeasure = options.onMeasure;

    Logger.info(`iOS: Starting performance polling for ${bundleId} (${this.deviceType})`);

    this.navigationCollector = new IOSNavigationEventCollector(this.deviceType);
    this.navigationCollector.start();

    const polling =
      this.deviceType === "simulator"
        ? this.pollSimulator(bundleId)
        : this.pollPhysicalDevice(bundleId);

    return {
      stop: () => {
        polling.stop();
        this.navigationCollector?.stop();
        this.navigationCollector = null;
      },
    };
  }

  detectCurrentBundleId(): string {
    return detectIOSBundleId();
  }

  installProfilerOnDevice() {
    // No installation step needed for either simulator or physical device
  }

  getScreenRecorder(): ScreenRecorder | undefined {
    return undefined;
  }

  cleanup: () => void = () => {
    this.navigationCollector?.stop();
    this.navigationCollector = null;
    if (this.simulatorPollingInterval) {
      clearInterval(this.simulatorPollingInterval);
      this.simulatorPollingInterval = null;
    }
    if (this.xctraceRecorder) {
      this.xctraceRecorder.cleanup();
      this.xctraceRecorder = null;
    }
  };

  async stopApp(bundleId: string): Promise<void> {
    try {
      if (this.deviceType === "simulator") {
        execSync(`xcrun simctl terminate booted ${bundleId}`);
      } else {
        // Use devicectl for iOS 17+ physical devices
        const deviceId = detectXCTraceDeviceId();
        if (deviceId) {
          execSync(
            `devicectl device process terminate --device ${deviceId} --bundle-identifier ${bundleId}`,
            { timeout: 10000 }
          );
        }
      }
    } catch (error) {
      Logger.debug(`Failed to stop app ${bundleId}: ${error}`);
    }
  }

  detectDeviceRefreshRate() {
    return 60;
  }
}
