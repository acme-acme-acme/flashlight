import { Logger } from "@perf-profiler/logger";
import { ChildProcess, execSync, spawnSync, spawn } from "child_process";
import os from "os";
import path from "path";
import fs from "fs";

export class XCTraceRecorder {
  private process: ChildProcess | null = null;
  private tracePath: string;
  private deviceId: string;
  private processExited = false;

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

    this.processExited = false;
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
      this.processExited = true;
    });

    this.process.on("exit", (code) => {
      Logger.info(`xctrace: recording stopped (exit code ${code})`);
      this.processExited = true;
    });
  }

  stop(): string {
    if (this.process && !this.processExited) {
      Logger.info("xctrace: sending SIGINT to stop recording...");
      this.process.kill("SIGINT");

      // Poll until the process exits or timeout after 15 seconds
      const deadline = Date.now() + 15000;
      while (!this.processExited && Date.now() < deadline) {
        spawnSync("sleep", ["0.5"]);
      }

      if (!this.processExited) {
        Logger.warn("xctrace: process did not exit after SIGINT, sending SIGKILL");
        this.process.kill("SIGKILL");
      }

      this.process = null;
    }

    // Verify the trace file exists
    if (fs.existsSync(this.tracePath)) {
      Logger.info(`xctrace: trace saved at ${this.tracePath}`);
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
