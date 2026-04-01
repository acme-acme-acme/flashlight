import {
  Measure,
  POLLING_INTERVAL,
  Profiler,
  ProfilerPollingOptions,
  ScreenRecorder,
} from "@perf-profiler/types";
import { Logger } from "@perf-profiler/logger";
import { ChildProcess, exec, execSync } from "child_process";
import { detectIOSBundleId } from "./detectBundleId";
import { IOSNavigationEventCollector, IOSDeviceType } from "./tpn/IOSNavigationEventCollector";

interface AppMonitorData {
  Pid: number;
  Name: string;
  CPU: string;
  Memory: string;
  DiskReads: string;
  DiskWrites: string;
  Threads: number;
  Time: string;
}

interface FPSData {
  currentTime: string;
  fps: number;
}

type DataTypes = "cpu" | "fps";

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
  private measures: Record<string, Measure> = {};
  private lastFPS: FPSData | null = null;
  private lastCpu: AppMonitorData | null = null;
  private onMeasure: ((measure: Measure) => void) | undefined;
  private navigationCollector: IOSNavigationEventCollector | null = null;
  private deviceType: IOSDeviceType;
  private simulatorPollingInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.deviceType = detectDeviceType();
  }

  parseData = async (childProcess: ChildProcess, type: DataTypes) => {
    childProcess?.stdout?.on("data", (data: Buffer) => {
      const raw = data.toString();
      Logger.debug(`iOS ${type} raw data: ${raw}`);
      try {
        const parsedData = JSON.parse(raw.replace(/'/g, '"'));
        if (type === "cpu") {
          (parsedData as AppMonitorData).Time = new Date().toISOString();
          this.lastCpu = parsedData;
          this.synchronizeData();
        }
        if (type === "fps") {
          this.lastFPS = parsedData as FPSData;
        }
      } catch (error) {
        Logger.debug(`iOS ${type} parse error: ${error}`);
      }
    });

    childProcess?.stderr?.on("data", (data: Buffer) => {
      Logger.warn(`iOS ${type} stderr: ${data.toString()}`);
    });

    childProcess?.on("error", (error) => {
      Logger.error(`iOS ${type} process error: ${error.message}`);
    });

    childProcess?.on("exit", (code) => {
      Logger.warn(`iOS ${type} process exited with code ${code}`);
    });
  };

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

    this.measures[measure.time] = measure;
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
    const cpuCmd = `pyidevice instruments appmonitor --format=flush -b ${bundleId} --time 500`;
    const fpsCmd = `pyidevice instruments fps --format=flush --time 500`;
    Logger.info(`iOS Physical Device CPU command: ${cpuCmd}`);
    Logger.info(`iOS Physical Device FPS command: ${fpsCmd}`);

    const cpuAndMemoryPolling = exec(cpuCmd);
    const fpsPolling = exec(fpsCmd);

    this.parseData(cpuAndMemoryPolling, "cpu");
    this.parseData(fpsPolling, "fps");

    return {
      stop: () => {
        cpuAndMemoryPolling.kill();
        fpsPolling.kill();
      },
    };
  }

  createMeasure = (lastCpu: AppMonitorData, lastFps: FPSData) => {
    const cpuMeasure = {
      perName: { Total: parseFloat(lastCpu.CPU.replace(" %", "")) },
      perCore: {},
    };

    const tpnEvents = this.navigationCollector?.flush() ?? [];
    if (tpnEvents.length > 0) {
      Logger.info(`iOS TPN flush: attaching ${tpnEvents.length} events to measure`);
    }

    const measure: Measure = {
      cpu: cpuMeasure,
      ram: parseFloat(lastCpu.Memory.replace(" MiB", "")),
      fps: lastFps.fps,
      time: new Date(lastCpu.Time).getTime(),
      ...(tpnEvents.length > 0 ? { tpn: tpnEvents } : {}),
    };
    this.measures[measure.time] = measure;
    if (this.onMeasure) {
      this.onMeasure(measure);
    }
  };

  synchronizeData = () => {
    const lastCpu = this.lastCpu;
    const lastFps = this.lastFPS;
    if (lastCpu && lastFps) {
      this.createMeasure(lastCpu, lastFps);
    }
  };

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
  };

  async stopApp(bundleId: string): Promise<void> {
    try {
      if (this.deviceType === "simulator") {
        execSync(`xcrun simctl terminate booted ${bundleId}`);
      } else {
        execSync(`pyidevice kill ${bundleId}`);
      }
    } catch (error) {
      Logger.debug(`Failed to stop app ${bundleId}: ${error}`);
    }
  }

  detectDeviceRefreshRate() {
    return 60;
  }
}
