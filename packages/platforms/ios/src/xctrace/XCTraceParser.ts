import { Logger } from "@perf-profiler/logger";
import { Measure } from "@perf-profiler/types";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

interface ProcessSnapshot {
  time: number;
  cpu: number;
  ram: number;
}

interface FPSSnapshot {
  time: number;
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
  const normalized = memStr.replace(",", ".");
  const match = normalized.match(/([\d.]+)\s*(KiB|MiB|GiB|bytes|Bytes)/);
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
    case "Bytes":
      return value / (1024 * 1024);
    default:
      return 0;
  }
};

const parseCpuPercent = (cpuStr: string): number => {
  const match = cpuStr.match(/([\d.,]+)%/);
  if (!match) return 0;
  return parseFloat(match[1].replace(",", "."));
};

const parseFps = (fpsStr: string): number => {
  const match = fpsStr.match(/(\d+)\s*FPS/);
  if (!match) return 0;
  return parseInt(match[1], 10);
};

/**
 * Parse xctrace XML export, handling both self-closing and nested elements.
 * Each row has top-level child elements (columns). We extract the `fmt` attribute
 * and resolve `ref` attributes using per-column id->fmt maps.
 */
const parseXCTraceXml = (xml: string): Map<number, string>[] => {
  const colRefs: Map<number, Map<string, string>> = new Map();
  const rows: Map<number, string>[] = [];

  // Match each <row>...</row> block
  const rowRegex = /<row>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowContent = rowMatch[1];
    const vals = new Map<number, string>();
    let colIdx = 0;

    // Match top-level elements within the row.
    // These can be self-closing (<tag attrs/>) or opening (<tag attrs>...</tag>)
    // We need to match at the top level only, not nested children.
    const topLevelRegex = /<([\w-]+)\s([^>]*?)(?:\/>|>[\s\S]*?<\/\1>)/g;
    let elemMatch;

    while ((elemMatch = topLevelRegex.exec(rowContent)) !== null) {
      const attrs = elemMatch[2];

      // Skip nested elements (like <pid> inside <process>)
      // We only want direct children of <row>
      // Check if this tag starts at a position that's inside another tag
      const precedingContent = rowContent.substring(0, elemMatch.index);
      const openTags = (precedingContent.match(/<[\w-]+\s[^>]*[^/]>/g) || []).length;
      const closeTags = (precedingContent.match(/<\/[\w-]+>/g) || []).length;
      if (openTags > closeTags) {
        // This element is nested inside another — skip it
        continue;
      }

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
      { encoding: "utf-8", timeout: 60000 }
    );

    const xml = fs.readFileSync(xmlPath, "utf-8");

    // Schema columns:
    // 0:start, 1:process, 2:responsible-process, 3:duration, 4:pid, 5:uid,
    // 6:cpu-percent, 7:cpu-total, 8:thread-count, 9:mach-port-count,
    // 10:memory-physical-footprint, ...
    const rows = parseXCTraceXml(xml);
    Logger.info(`xctrace parser: parsed ${rows.length} total process rows`);

    // Log first few process names to help debug matching
    const processNames = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      const name = row.get(1);
      if (name) processNames.add(name);
    }
    Logger.info(
      `xctrace parser: sample process names: ${[...processNames].slice(0, 10).join(", ")}`
    );

    // Match by bundle ID parts. The process name in xctrace looks like "AppName (PID)"
    // For bundle ID "com.clary.so.dev", try matching: "clary", "so", "dev", "Clary", etc.
    const bundleParts = bundleId.split(".").filter((p) => p.length > 2);
    Logger.info(`xctrace parser: matching against bundle parts: ${bundleParts.join(", ")}`);

    const snapshots: ProcessSnapshot[] = [];
    for (const row of rows) {
      const processName = row.get(1) || "";
      const startTime = row.get(0) || "";
      const cpuStr = row.get(6) || "";
      const memStr = row.get(10) || "";

      // Try to match the process name against any part of the bundle ID
      const processLower = processName.toLowerCase();
      const matches = bundleParts.some(
        (part) => processLower.includes(part.toLowerCase()) && part.toLowerCase() !== "com"
      );

      if (matches && startTime && cpuStr) {
        snapshots.push({
          time: parseTimeToMs(startTime),
          cpu: parseCpuPercent(cpuStr),
          ram: parseMemoryToMiB(memStr),
        });
      }
    }

    Logger.info(
      `xctrace parser: found ${snapshots.length} process snapshots for "${bundleId}" out of ${rows.length} total rows`
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
      { encoding: "utf-8", timeout: 60000 }
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
