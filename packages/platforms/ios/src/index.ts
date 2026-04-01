import {
  Measure,
  POLLING_INTERVAL,
  Profiler,
  ProfilerPollingOptions,
  ScreenRecorder,
} from "@perf-profiler/types";
import { Logger } from "@perf-profiler/logger";
import { ChildProcess, execSync, spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";
import { detectIOSBundleId } from "./detectBundleId";
import { IOSNavigationEventCollector, IOSDeviceType } from "./tpn/IOSNavigationEventCollector";
import { detectXCTraceDeviceId } from "./xctrace/XCTraceRecorder";
import { parseTrace } from "./xctrace/XCTraceParser";

const PHYSICAL_DEVICE_RECORDING_SECONDS = 10;

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
    const appInfo = execSync(`xcrun simctl appinfo booted ${bundleId}`, { encoding: "utf-8" });
    const exeMatch = appInfo.match(/CFBundleExecutable\s*=\s*"?([^";\n]+)"?/);
    if (!exeMatch) {
      Logger.warn(`Could not find CFBundleExecutable for ${bundleId}`);
      return null;
    }
    const exeName = exeMatch[1].trim();
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
  private xctraceProcess: ChildProcess | null = null;

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
      ram: ramKb / 1024,
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
        const output = execSync(`ps -p ${pid} -o %cpu=,rss=`, { encoding: "utf-8" }).trim();
        if (!output) return;

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

    const tracePath = path.join(os.tmpdir(), `flashlight-trace-${Date.now()}.trace`);
    const duration = PHYSICAL_DEVICE_RECORDING_SECONDS;

    Logger.info(`iOS Physical Device: starting ${duration}s xctrace recording to ${tracePath}`);
    Logger.info(
      `iOS Physical Device: metrics will appear after the ${duration}s recording completes.`
    );

    // Use async spawn with --time-limit so Node's event loop stays responsive
    // xctrace will exit cleanly when the time limit is reached, producing a valid trace
    this.xctraceProcess = spawn(
      "xctrace",
      [
        "record",
        "--device",
        deviceId,
        "--template",
        "Activity Monitor",
        "--instrument",
        "Core Animation FPS",
        "--all-processes",
        "--output",
        tracePath,
        "--time-limit",
        `${duration}s`,
        "--no-prompt",
      ],
      { stdio: ["pipe", "pipe", "pipe"] }
    );

    this.xctraceProcess.stdout?.on("data", (data: Buffer) => {
      Logger.info(`xctrace: ${data.toString().trim()}`);
    });

    this.xctraceProcess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) Logger.warn(`xctrace stderr: ${msg}`);
    });

    this.xctraceProcess.on("error", (error) => {
      Logger.error(`xctrace process error: ${error.message}`);
      this.xctraceProcess = null;
    });

    this.xctraceProcess.on("exit", (code) => {
      Logger.info(`xctrace: recording finished (exit code ${code})`);
      this.xctraceProcess = null;

      if (code !== 0) {
        Logger.error(`xctrace recording failed (exit code ${code})`);
        return;
      }

      // Parse the trace and emit all measures retroactively
      Logger.info(`iOS Physical Device: parsing trace for "${bundleId}"...`);
      try {
        const measures = parseTrace(tracePath, bundleId);
        Logger.info(`iOS Physical Device: parsed ${measures.length} measures`);

        if (measures.length === 0) {
          Logger.warn(
            `iOS Physical Device: no measures found for "${bundleId}". ` +
              `The app name in the trace may differ.`
          );
        }

        for (const measure of measures) {
          if (this.onMeasure) {
            this.onMeasure(measure);
          }
        }
      } catch (error) {
        Logger.error(`iOS Physical Device: trace parsing failed: ${error}`);
      } finally {
        if (fs.existsSync(tracePath)) {
          fs.rmSync(tracePath, { recursive: true });
        }
      }
    });

    return {
      stop: () => {
        if (this.xctraceProcess) {
          Logger.info(
            `iOS Physical Device: recording still in progress (${duration}s total). ` +
              `Measures will appear when the recording finishes.`
          );
        } else {
          Logger.info("iOS Physical Device: recording already complete");
        }
      },
    };
  }

  pollPerformanceMeasures(bundleId: string, options: ProfilerPollingOptions): { stop: () => void } {
    this.onMeasure = options.onMeasure;

    Logger.info(`iOS: Starting performance polling for ${bundleId} (${this.deviceType})`);

    // Only start TPN for simulator (physical device doesn't have a CLI log stream tool)
    if (this.deviceType === "simulator") {
      this.navigationCollector = new IOSNavigationEventCollector(this.deviceType);
      this.navigationCollector.start();
    }

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
    // No installation step needed
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
    if (this.xctraceProcess) {
      this.xctraceProcess.kill("SIGKILL");
      this.xctraceProcess = null;
    }
  };

  async stopApp(bundleId: string): Promise<void> {
    try {
      if (this.deviceType === "simulator") {
        execSync(`xcrun simctl terminate booted ${bundleId}`);
      } else {
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
