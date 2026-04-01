import { Logger } from "@perf-profiler/logger";
import { execSync } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

const DEFAULT_RECORDING_DURATION_S = 60;

export class XCTraceRecorder {
  private tracePath: string;
  private deviceId: string;
  private durationSeconds: number;
  private recording = false;
  private recordingComplete = false;

  constructor(deviceId: string, durationSeconds?: number) {
    this.deviceId = deviceId;
    this.durationSeconds = durationSeconds || DEFAULT_RECORDING_DURATION_S;
    this.tracePath = path.join(os.tmpdir(), `flashlight-trace-${Date.now()}.trace`);
  }

  /**
   * Start recording synchronously in a background thread.
   * The recording runs for the specified duration and then stops automatically.
   * This is non-blocking — it spawns the recording in a detached child process.
   */
  start(): void {
    if (fs.existsSync(this.tracePath)) {
      fs.rmSync(this.tracePath, { recursive: true });
    }

    this.recording = true;
    this.recordingComplete = false;

    Logger.info(`xctrace: starting ${this.durationSeconds}s recording to ${this.tracePath}`);

    // Run xctrace in a shell background process with time-limit
    // We write a PID file so we can kill it early if needed
    const pidFile = path.join(os.tmpdir(), `flashlight-xctrace-${Date.now()}.pid`);
    const cmd =
      `xctrace record` +
      ` --device "${this.deviceId}"` +
      ` --template "Activity Monitor"` +
      ` --instrument "Core Animation FPS"` +
      ` --all-processes` +
      ` --output "${this.tracePath}"` +
      ` --time-limit ${this.durationSeconds}s` +
      ` --no-prompt`;

    Logger.info(`xctrace: ${cmd}`);

    // Launch in background via shell, saving PID
    execSync(`sh -c '${cmd} & echo $! > "${pidFile}" && wait'`, {
      encoding: "utf-8",
      timeout: (this.durationSeconds + 10) * 1000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.recordingComplete = true;
    this.recording = false;

    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    if (fs.existsSync(this.tracePath)) {
      Logger.info(`xctrace: recording complete, trace saved at ${this.tracePath}`);
    } else {
      Logger.error(`xctrace: recording finished but trace file not found`);
    }
  }

  /**
   * Start recording and block until complete. Returns the trace path.
   */
  recordSync(): string {
    this.start();
    return this.tracePath;
  }

  getTracePath(): string {
    return this.tracePath;
  }

  isComplete(): boolean {
    return this.recordingComplete;
  }

  cleanup(): void {
    if (fs.existsSync(this.tracePath)) {
      fs.rmSync(this.tracePath, { recursive: true });
    }
  }
}

export const detectXCTraceDeviceId = (): string | null => {
  try {
    const output = execSync("xctrace list devices", { encoding: "utf-8" });
    const lines = output.split("\n");
    let inDevices = false;

    for (const line of lines) {
      if (line.startsWith("== Devices ==")) {
        inDevices = true;
        continue;
      }
      if (line.startsWith("== Simulators ==")) {
        break;
      }
      if (inDevices && line.includes("(") && !line.includes("Mac")) {
        const match = line.match(/\(([A-F0-9-]+)\)\s*$/);
        if (match) {
          Logger.info(`xctrace: detected physical device: ${match[1]}`);
          return match[1];
        }
      }
    }
  } catch (error) {
    Logger.debug(`xctrace: failed to detect device: ${error}`);
  }
  return null;
};
