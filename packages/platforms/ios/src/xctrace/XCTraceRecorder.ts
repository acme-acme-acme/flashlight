import { Logger } from "@perf-profiler/logger";
import { ChildProcess, execSync, spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

export class XCTraceRecorder {
  private process: ChildProcess | null = null;
  private tracePath: string;
  private deviceId: string;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
    this.tracePath = path.join(os.tmpdir(), `flashlight-trace-${Date.now()}.trace`);
  }

  start(): void {
    // Clean up any previous trace at this path
    if (fs.existsSync(this.tracePath)) {
      fs.rmSync(this.tracePath, { recursive: true });
    }

    const args = [
      "record",
      "--device",
      this.deviceId,
      "--template",
      "Activity Monitor",
      "--instrument",
      "Core Animation FPS",
      "--all-processes",
      "--output",
      this.tracePath,
      "--no-prompt",
    ];

    Logger.info(`xctrace: starting recording to ${this.tracePath}`);
    Logger.info(`xctrace: xctrace ${args.join(" ")}`);

    this.process = spawn("xctrace", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      Logger.debug(`xctrace stdout: ${data.toString().trim()}`);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      Logger.debug(`xctrace stderr: ${data.toString().trim()}`);
    });

    this.process.on("error", (error) => {
      Logger.error(`xctrace process error: ${error.message}`);
    });

    this.process.on("exit", (code) => {
      Logger.info(`xctrace: recording stopped (exit code ${code})`);
    });
  }

  stop(): string {
    if (this.process) {
      const pid = this.process.pid;
      Logger.info(`xctrace: sending SIGINT to PID ${pid} to stop recording...`);
      this.process.kill("SIGINT");
      this.process = null;

      // Use a synchronous subprocess to wait for xctrace to fully exit and write the trace
      // This blocks the Node process but ensures the trace file is complete
      if (pid) {
        try {
          // Wait for the xctrace process to finish by polling its existence
          execSync(`while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`, { timeout: 20000 });
        } catch {
          Logger.warn("xctrace: timeout waiting for process to exit");
        }
      }

      // Extra safety margin for filesystem flush
      execSync("sleep 1");
    }

    // Verify the trace file exists
    if (fs.existsSync(this.tracePath)) {
      const files = fs.readdirSync(this.tracePath);
      Logger.info(`xctrace: trace saved at ${this.tracePath} (contents: ${files.join(", ")})`);
    } else {
      Logger.error(`xctrace: trace file not found at ${this.tracePath}`);
    }

    return this.tracePath;
  }

  getTracePath(): string {
    return this.tracePath;
  }

  cleanup(): void {
    if (this.process) {
      this.process.kill("SIGKILL");
      this.process = null;
    }
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
        // Match: iPhone von Tom (2) (26.3.1) (00008140-001409922EEB801C)
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
