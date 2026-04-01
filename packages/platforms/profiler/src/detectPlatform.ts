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
    const output = execSync("pyidevice devicelist", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim().length > 0;
  } catch {
    return false;
  }
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

  throw new Error(
    "No iOS or Android devices detected. Checked:\n" +
      "  - iOS Simulator: xcrun simctl list devices booted\n" +
      "  - iOS Physical: pyidevice devicelist\n" +
      "  - Android: adb devices\n" +
      "Make sure a device or simulator is running."
  );
};
