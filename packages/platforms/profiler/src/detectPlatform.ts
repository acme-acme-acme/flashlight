import { execSync } from "child_process";
import { Logger } from "@perf-profiler/logger";

export type Platform = "ios" | "android" | "flashlight";

const hasBootedIOSSimulator = (): boolean => {
  try {
    const output = execSync("xcrun simctl list devices booted", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.includes("Booted");
  } catch {
    return false;
  }
};

const hasIOSPhysicalDevice = (): boolean => {
  try {
    const output = execSync("devicectl list devices", {
      encoding: "utf-8",
      timeout: 10000,
    });
    // Look for a line with "connected" after the separator
    const lines = output.split("\n");
    let headerPassed = false;
    for (const line of lines) {
      if (line.match(/^-+\s+-+/)) {
        headerPassed = true;
        continue;
      }
      const lineLower = line.toLowerCase();
      if (headerPassed && (lineLower.includes("connected") || lineLower.includes("available"))) {
        return true;
      }
    }
  } catch {
    // devicectl not available
  }
  return false;
};

const hasAndroidDevice = (): boolean => {
  try {
    const output = execSync("adb devices", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = output.split("\n").filter((line) => line.includes("\tdevice"));
    return lines.length > 0;
  } catch {
    return false;
  }
};

export const detectPlatform = (): Platform => {
  const envPlatform = process.env.PLATFORM;
  if (envPlatform === "ios" || envPlatform === "android" || envPlatform === "flashlight") {
    Logger.info(`Platform override via PLATFORM env var: ${envPlatform}`);
    return envPlatform;
  }

  const hasIOS = hasBootedIOSSimulator() || hasIOSPhysicalDevice();
  const hasAndroid = hasAndroidDevice();

  if (hasIOS && hasAndroid) {
    throw new Error(
      "Both iOS and Android devices detected. Set the PLATFORM environment variable to 'ios' or 'android' to choose."
    );
  }

  if (hasIOS) {
    Logger.info("Auto-detected platform: iOS");
    return "ios";
  }

  if (hasAndroid) {
    Logger.info("Auto-detected platform: Android");
    return "android";
  }

  Logger.debug(
    "No iOS or Android devices detected. Defaulting to Android. Checked:\n" +
      "  - iOS Simulator: xcrun simctl list devices booted\n" +
      "  - iOS Physical: devicectl list devices\n" +
      "  - Android: adb devices"
  );
  return "android";
};
