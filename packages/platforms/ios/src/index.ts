import { Measure, Profiler, ProfilerPollingOptions, ScreenRecorder } from "@perf-profiler/types";
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

export class IOSProfiler implements Profiler {
  private measures: Record<string, Measure> = {};
  private lastFPS: FPSData | null = null;
  private lastCpu: AppMonitorData | null = null;
  private onMeasure: ((measure: Measure) => void) | undefined;
  private navigationCollector: IOSNavigationEventCollector | null = null;
  private deviceType: IOSDeviceType;

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

    const cpuCmd = `pyidevice instruments appmonitor --format=flush -b ${bundleId} --time 500`;
    const fpsCmd = `pyidevice instruments fps --format=flush --time 500`;
    Logger.info(`iOS CPU command: ${cpuCmd}`);
    Logger.info(`iOS FPS command: ${fpsCmd}`);

    const cpuAndMemoryPolling = exec(cpuCmd);
    const fpsPolling = exec(fpsCmd);

    this.parseData(cpuAndMemoryPolling, "cpu");
    this.parseData(fpsPolling, "fps");

    return {
      stop: () => {
        cpuAndMemoryPolling.kill();
        fpsPolling.kill();
        this.navigationCollector?.stop();
        this.navigationCollector = null;
      },
    };
  }

  detectCurrentBundleId(): string {
    return detectIOSBundleId();
  }

  installProfilerOnDevice() {
    // pyidevice handles connection automatically — no installation step needed
  }

  getScreenRecorder(): ScreenRecorder | undefined {
    return undefined;
  }

  cleanup: () => void = () => {
    this.navigationCollector?.stop();
    this.navigationCollector = null;
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
