import { Logger } from "@perf-profiler/logger";
import { Measure } from "@perf-profiler/types";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

interface ProcessSnapshot {
  time: number; // ms from start
  cpu: number; // percentage
  ram: number; // MiB
}

interface FPSSnapshot {
  time: number; // ms from start
  fps: number;
}

const parseTimeToMs = (timeStr: string): number => {
  // Format: "00:01.234.567" -> mm:ss.ms.us
  const match = timeStr.match(/^(\d+):(\d+)\.(\d+)/);
  if (!match) return 0;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const millis = parseInt(match[3], 10);
  return minutes * 60000 + seconds * 1000 + millis;
};

const parseMemoryToMiB = (memStr: string): number => {
  // Formats: "36,00 MiB", "528,00 KiB", "1,23 GiB"
  const normalized = memStr.replace(",", ".");
  const match = normalized.match(/([\d.]+)\s*(KiB|MiB|GiB|bytes)/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  switch (match[2]) {
    case "GiB":
      return value * 1024;
    case "MiB":
      return value;
    case "KiB":
      return value / 1024;
    case "bytes":
      return value / (1024 * 1024);
    default:
      return 0;
  }
};

const parseCpuPercent = (cpuStr: string): number => {
  // Format: "1.5%" or "0.0%"
  const match = cpuStr.match(/([\d.,]+)%/);
  if (!match) return 0;
  return parseFloat(match[1].replace(",", "."));
};

const parseFps = (fpsStr: string): number => {
  // Format: "60 FPS" or "0 FPS"
  const match = fpsStr.match(/(\d+)\s*FPS/);
  if (!match) return 0;
  return parseInt(match[1], 10);
};

/**
 * Simple XML element extractor using regex.
 * xctrace XML uses id/ref deduplication per column position.
 * We resolve refs to get actual values.
 */
const parseXCTraceXml = (xml: string): Map<number, string>[] => {
  // Build per-column ref maps: col_index -> { id -> fmt }
  const colRefs: Map<number, Map<string, string>> = new Map();

  // Extract all rows
  const rows: Map<number, string>[] = [];
  const rowRegex = /<row>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowContent = rowMatch[1];
    // Extract all child elements in order
    const elemRegex = /<(\w[\w-]*)\s([^>]*)\/>/g;
    let elemMatch;
    const vals = new Map<number, string>();
    let colIdx = 0;

    while ((elemMatch = elemRegex.exec(rowContent)) !== null) {
      const attrs = elemMatch[2];
      const id = attrs.match(/id="(\d+)"/)?.[1];
      const ref = attrs.match(/ref="(\d+)"/)?.[1];
      const fmt = attrs.match(/fmt="([^"]*)"/)?.[1];

      if (!colRefs.has(colIdx)) {
        colRefs.set(colIdx, new Map());
      }

      if (id && fmt) {
        colRefs.get(colIdx)!.set(id, fmt);
      }

      if (fmt) {
        vals.set(colIdx, fmt);
      } else if (ref) {
        const resolved = colRefs.get(colIdx)?.get(ref);
        if (resolved) {
          vals.set(colIdx, resolved);
        }
      }

      colIdx++;
    }

    if (vals.size > 0) {
      rows.push(vals);
    }
  }

  return rows;
};

export const parseProcessData = (tracePath: string, bundleId: string): ProcessSnapshot[] => {
  const xmlPath = path.join(os.tmpdir(), `flashlight-process-${Date.now()}.xml`);

  try {
    execSync(
      `xctrace export --input "${tracePath}" --xpath '/trace-toc/run[@number="1"]/data/table[@schema="activity-monitor-process-live"]' --output "${xmlPath}"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const xml = fs.readFileSync(xmlPath, "utf-8");

    // Schema columns (27 total):
    // 0:start, 1:process, 2:responsible-process, 3:duration, 4:pid, 5:uid,
    // 6:cpu-percent, 7:cpu-total, 8:thread-count, 9:mach-port-count,
    // 10:memory-physical-footprint, ...
    const rows = parseXCTraceXml(xml);

    // Find the process name that matches the bundleId
    // Process names in xctrace look like "MyApp (12345)"
    // We need to match by the app executable name
    const appName = bundleId.split(".").pop() || bundleId;

    const snapshots: ProcessSnapshot[] = [];
    for (const row of rows) {
      const processName = row.get(1) || "";
      const startTime = row.get(0) || "";
      const cpuStr = row.get(6) || "";
      const memStr = row.get(10) || "";

      // Match process by bundle ID parts or app name
      const processLower = processName.toLowerCase();
      if (
        processLower.includes(appName.toLowerCase()) ||
        processLower.includes(bundleId.toLowerCase())
      ) {
        if (startTime && cpuStr) {
          snapshots.push({
            time: parseTimeToMs(startTime),
            cpu: parseCpuPercent(cpuStr),
            ram: parseMemoryToMiB(memStr),
          });
        }
      }
    }

    Logger.info(
      `xctrace parser: found ${snapshots.length} process snapshots for "${appName}" out of ${rows.length} total rows`
    );
    return snapshots;
  } catch (error) {
    Logger.error(`xctrace parser: failed to parse process data: ${error}`);
    return [];
  } finally {
    if (fs.existsSync(xmlPath)) {
      fs.unlinkSync(xmlPath);
    }
  }
};

export const parseFpsData = (tracePath: string): FPSSnapshot[] => {
  const xmlPath = path.join(os.tmpdir(), `flashlight-fps-${Date.now()}.xml`);

  try {
    execSync(
      `xctrace export --input "${tracePath}" --xpath '/trace-toc/run[@number="1"]/data/table[@schema="core-animation-fps-estimate"]' --output "${xmlPath}"`,
      { encoding: "utf-8", timeout: 30000 }
    );

    const xml = fs.readFileSync(xmlPath, "utf-8");

    // Schema: 0:interval, 1:period, 2:fps, 3:device-utilization
    const rows = parseXCTraceXml(xml);

    const snapshots: FPSSnapshot[] = [];
    for (const row of rows) {
      const interval = row.get(0) || "";
      const fpsStr = row.get(2) || "";

      if (interval && fpsStr) {
        snapshots.push({
          time: parseTimeToMs(interval),
          fps: parseFps(fpsStr),
        });
      }
    }

    Logger.info(`xctrace parser: found ${snapshots.length} FPS snapshots`);
    return snapshots;
  } catch (error) {
    Logger.error(`xctrace parser: failed to parse FPS data: ${error}`);
    return [];
  } finally {
    if (fs.existsSync(xmlPath)) {
      fs.unlinkSync(xmlPath);
    }
  }
};

/**
 * Combine process snapshots and FPS snapshots into Measure objects.
 * FPS data is at ~1s intervals, process data is more frequent.
 * We assign the closest FPS value to each process snapshot.
 */
export const buildMeasures = (
  processData: ProcessSnapshot[],
  fpsData: FPSSnapshot[]
): Measure[] => {
  const getFpsAtTime = (timeMs: number): number | undefined => {
    if (fpsData.length === 0) return undefined;

    let closest = fpsData[0];
    for (const fps of fpsData) {
      if (Math.abs(fps.time - timeMs) < Math.abs(closest.time - timeMs)) {
        closest = fps;
      }
    }
    return closest.fps;
  };

  return processData.map((snapshot) => ({
    cpu: {
      perName: { Total: snapshot.cpu },
      perCore: {},
    },
    ram: snapshot.ram,
    fps: getFpsAtTime(snapshot.time),
    time: snapshot.time,
  }));
};

/**
 * Parse an xctrace trace file and return Measure objects for a given bundle ID.
 */
export const parseTrace = (tracePath: string, bundleId: string): Measure[] => {
  Logger.info(`xctrace parser: parsing trace at ${tracePath} for ${bundleId}`);

  if (!fs.existsSync(tracePath)) {
    Logger.error(`xctrace parser: trace file not found: ${tracePath}`);
    return [];
  }

  const processData = parseProcessData(tracePath, bundleId);
  const fpsData = parseFpsData(tracePath);

  const measures = buildMeasures(processData, fpsData);
  Logger.info(
    `xctrace parser: produced ${measures.length} measures (${processData.length} CPU/RAM snapshots, ${fpsData.length} FPS snapshots)`
  );

  return measures;
};
