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

export const parseDevicectlApps = (output: string): string[] => {
  // Output format:
  // Name              Bundle Identifier      Version   Bundle Version
  // ---------------   --------------------   -------   --------------
  // Clary             com.clary.so           1.8.0     74
  const lines = output.split("\n");
  const apps: string[] = [];

  let headerPassed = false;
  for (const line of lines) {
    // Skip until we pass the separator line (dashes)
    if (line.match(/^-+\s+-+/)) {
      headerPassed = true;
      continue;
    }
    if (!headerPassed) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split by 3+ spaces to get columns
    const parts = trimmed.split(/\s{3,}/);
    if (parts.length >= 2) {
      const bundleId = parts[1].trim();
      if (bundleId && bundleId.includes(".")) {
        apps.push(bundleId);
      }
    }
  }

  return apps;
};

const detectDevicectlDeviceId = (): string | null => {
  try {
    const output = execSync("devicectl list devices", {
      encoding: "utf-8",
      timeout: 10000,
    });
    // Parse: Name   Hostname   Identifier   State   Model
    const lines = output.split("\n");
    let headerPassed = false;
    for (const line of lines) {
      if (line.match(/^-+\s+-+/)) {
        headerPassed = true;
        continue;
      }
      if (!headerPassed) continue;

      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split(/\s{3,}/);
      // parts: [Name, Hostname, Identifier, State, Model]
      if (parts.length >= 4 && parts[3].toLowerCase() === "connected") {
        return parts[2].trim();
      }
    }
  } catch {
    Logger.debug("Failed to list devices via devicectl");
  }
  return null;
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
  const deviceId = detectDevicectlDeviceId();
  if (!deviceId) {
    Logger.debug("No physical iOS device found via devicectl");
    return null;
  }

  try {
    const output = execSync(`devicectl device info apps --device ${deviceId}`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    const apps = parseDevicectlApps(output);
    if (apps.length > 0) {
      Logger.info(`Detected ${apps.length} apps on physical device, first: ${apps[0]}`);
      return apps[0];
    }
  } catch (error) {
    Logger.debug(`Failed to detect bundle ID from physical device: ${error}`);
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
