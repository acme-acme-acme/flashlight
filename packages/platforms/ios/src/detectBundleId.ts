import { execSync } from "child_process";
import { Logger } from "@perf-profiler/logger";

export const parseSimulatorApps = (output: string): string[] => {
  if (!output.trim()) return [];

  const userApps: string[] = [];
  const appBlocks = output.split(/"\s*=\s*\{/);

  for (const block of appBlocks) {
    if (block.includes("ApplicationType = User")) {
      const match = block.match(/BundleIdentifier\s*=\s*"([^"]+)"/);
      if (match) {
        userApps.push(match[1]);
      }
    }
  }

  return userApps;
};

export const parsePyideviceAppList = (output: string): string[] => {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const detectSimulatorBundleId = (): string | null => {
  try {
    const output = execSync("xcrun simctl listapps booted", { encoding: "utf-8" });
    const apps = parseSimulatorApps(output);
    if (apps.length > 0) {
      return apps[0];
    }
  } catch {
    Logger.debug("Failed to detect bundle ID from simulator");
  }
  return null;
};

const detectPhysicalDeviceBundleId = (): string | null => {
  try {
    const output = execSync("pyidevice instruments applist", { encoding: "utf-8" });
    const apps = parsePyideviceAppList(output);
    if (apps.length > 0) {
      return apps[0];
    }
  } catch {
    Logger.debug("Failed to detect bundle ID from physical device");
  }
  return null;
};

export const detectIOSBundleId = (): string => {
  const simulatorBundleId = detectSimulatorBundleId();
  if (simulatorBundleId) return simulatorBundleId;

  const physicalBundleId = detectPhysicalDeviceBundleId();
  if (physicalBundleId) return physicalBundleId;

  throw new Error(
    "Could not detect iOS bundle ID. Make sure an app is running on a booted simulator or connected device."
  );
};
