# Default Port & TPN Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the default measure server port to 4000, and add a TimePerNavigation (TPN) metric that measures route-to-route navigation duration in React Native apps via logcat markers.

**Architecture:** A lightweight pure-JS SDK (`@flashlight/navigation-tracker`) emits structured `[FLASHLIGHT_TPN]` log lines via `console.log` (which writes to Android logcat). The Android profiler spawns a parallel `adb logcat` reader to capture these markers, parses them into `NavigationEvent` objects, and attaches them to the existing `Measure` type. The reporter computes stats per route pair, and the web UI renders a horizontal bar chart.

**Tech Stack:** TypeScript, React, React Native, Jest, ApexCharts, adb/logcat

---

## File Structure

### Feature 1: Default Port

- **Modify:** `packages/commands/measure/src/server/constants.ts` — change DEFAULT_PORT from 3000 to 4000
- **Modify:** `packages/commands/measure/src/webapp/index.html` — update placeholder URL

### Feature 2: TPN Metric

**Types:**

- **Modify:** `packages/core/types/index.ts` — add `NavigationEvent` interface, add `tpn?` field to `Measure`

**SDK (new package):**

- **Create:** `packages/plugins/navigation-tracker/package.json`
- **Create:** `packages/plugins/navigation-tracker/tsconfig.json`
- **Create:** `packages/plugins/navigation-tracker/src/index.ts` — `withNavigationTracker` HOC
- **Create:** `packages/plugins/navigation-tracker/src/__tests__/navigationTracker.test.ts`

**Profiler collection:**

- **Create:** `packages/platforms/android/src/commands/tpn/pollNavigationEvents.ts` — logcat reader + parser
- **Create:** `packages/platforms/android/src/commands/tpn/__tests__/pollNavigationEvents.test.ts`
- **Modify:** `packages/platforms/android/src/commands/platforms/UnixProfiler.ts` — attach TPN events to Measure

**Reporting:**

- **Create:** `packages/core/reporter/src/reporting/tpn.ts` — stats functions
- **Create:** `packages/core/reporter/src/reporting/__tests__/tpn.test.ts`
- **Modify:** `packages/core/reporter/src/reporting/Report.ts` — add TPN to ReportMetrics
- **Modify:** `packages/core/reporter/src/index.ts` — re-export tpn

**Web UI:**

- **Create:** `packages/core/web-reporter-ui/src/sections/TPNReport.tsx` — bar chart component
- **Modify:** `packages/core/web-reporter-ui/ReporterView.tsx` — add TPNReport section

---

## Task 1: Change Default Port to 4000

**Files:**

- Modify: `packages/commands/measure/src/server/constants.ts:1`
- Modify: `packages/commands/measure/src/webapp/index.html:27`

- [ ] **Step 1: Update DEFAULT_PORT constant**

In `packages/commands/measure/src/server/constants.ts`, change line 1:

```typescript
export const DEFAULT_PORT = 4000;
```

- [ ] **Step 2: Update HTML placeholder**

In `packages/commands/measure/src/webapp/index.html`, change line 27:

```html
window.__FLASHLIGHT_DATA__ = { socketServerUrl: "http://localhost:4000" };
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `yarn jest measure --no-coverage`

Expected: Tests pass. The existing test at `packages/commands/measure/src/__tests__/measure.test.tsx` uses `DEFAULT_PORT` via import, so it adapts automatically. Snapshot tests may need updating.

- [ ] **Step 4: Update snapshots if needed**

Run: `yarn jest measure --no-coverage -u`

- [ ] **Step 5: Commit**

```bash
git add packages/commands/measure/src/server/constants.ts packages/commands/measure/src/webapp/index.html
git commit -m "feat(measure): change default server port to 4000"
```

---

## Task 2: Add NavigationEvent Type and tpn Field to Measure

**Files:**

- Modify: `packages/core/types/index.ts`

- [ ] **Step 1: Add NavigationEvent interface and tpn field**

In `packages/core/types/index.ts`, add the `NavigationEvent` interface before the `Measure` interface (before line 6), and add `tpn?` to `Measure`:

```typescript
export interface NavigationEvent {
  from: string;
  to: string;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface Measure {
  cpu: CpuMeasure;
  ram?: number;
  fps?: number;
  tpn?: NavigationEvent[];
  time: number;
}
```

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `yarn jest --no-coverage`

Expected: All existing tests pass. The `tpn` field is optional so no existing code breaks.

- [ ] **Step 3: Commit**

```bash
git add packages/core/types/index.ts
git commit -m "feat(types): add NavigationEvent interface and tpn field to Measure"
```

---

## Task 3: TPN Reporting Functions

**Files:**

- Create: `packages/core/reporter/src/reporting/tpn.ts`
- Create: `packages/core/reporter/src/reporting/__tests__/tpn.test.ts`
- Modify: `packages/core/reporter/src/index.ts`

- [ ] **Step 1: Write failing tests for TPN reporting**

Create `packages/core/reporter/src/reporting/__tests__/tpn.test.ts`:

```typescript
import { Measure, NavigationEvent, TestCaseIterationResult } from "@perf-profiler/types";
import { getAverageNavigationTime, getNavigationStats, getSlowestNavigations } from "../tpn";

const makeEvent = (from: string, to: string, duration: number, startTime = 0): NavigationEvent => ({
  from,
  to,
  startTime,
  endTime: startTime + duration,
  duration,
});

const makeMeasure = (tpn?: NavigationEvent[]): Measure => ({
  cpu: { perName: {}, perCore: {} },
  ram: 100,
  fps: 60,
  tpn,
  time: 0,
});

describe("getAverageNavigationTime", () => {
  it("returns undefined when no tpn events exist", () => {
    const measures = [makeMeasure(), makeMeasure()];
    expect(getAverageNavigationTime(measures)).toBeUndefined();
  });

  it("returns undefined when all tpn arrays are empty", () => {
    const measures = [makeMeasure([]), makeMeasure([])];
    expect(getAverageNavigationTime(measures)).toBeUndefined();
  });

  it("computes average duration across all navigation events", () => {
    const measures = [
      makeMeasure([makeEvent("Home", "Profile", 200), makeEvent("Profile", "Settings", 400)]),
      makeMeasure([makeEvent("Settings", "Home", 300)]),
    ];
    expect(getAverageNavigationTime(measures)).toBe(300);
  });
});

describe("getSlowestNavigations", () => {
  it("returns empty array when no tpn events exist", () => {
    const measures = [makeMeasure()];
    expect(getSlowestNavigations(measures)).toEqual([]);
  });

  it("returns events sorted by duration descending, limited to top N", () => {
    const events = [
      makeEvent("A", "B", 100),
      makeEvent("B", "C", 500),
      makeEvent("C", "D", 300),
      makeEvent("D", "E", 200),
      makeEvent("E", "F", 400),
    ];
    const measures = [makeMeasure(events)];
    const result = getSlowestNavigations(measures, 3);
    expect(result).toEqual([
      makeEvent("B", "C", 500),
      makeEvent("E", "F", 400),
      makeEvent("C", "D", 300),
    ]);
  });
});

describe("getNavigationStats", () => {
  it("returns empty object when no tpn events exist", () => {
    const iterations: TestCaseIterationResult[] = [
      { time: 1000, measures: [makeMeasure()], status: "SUCCESS" },
    ];
    expect(getNavigationStats(iterations)).toEqual({});
  });

  it("computes stats per route pair across iterations", () => {
    const iterations: TestCaseIterationResult[] = [
      {
        time: 1000,
        measures: [makeMeasure([makeEvent("Home", "Profile", 200)])],
        status: "SUCCESS",
      },
      {
        time: 1000,
        measures: [makeMeasure([makeEvent("Home", "Profile", 400)])],
        status: "SUCCESS",
      },
    ];
    const stats = getNavigationStats(iterations);
    expect(stats["Home -> Profile"]).toBeDefined();
    expect(stats["Home -> Profile"].average).toBe(300);
    expect(stats["Home -> Profile"].min).toBe(200);
    expect(stats["Home -> Profile"].max).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn jest tpn --no-coverage`

Expected: FAIL — module `../tpn` not found.

- [ ] **Step 3: Implement TPN reporting functions**

Create `packages/core/reporter/src/reporting/tpn.ts`:

```typescript
import { Measure, NavigationEvent, TestCaseIterationResult } from "@perf-profiler/types";

const collectAllEvents = (measures: Measure[]): NavigationEvent[] =>
  measures.flatMap((m) => m.tpn ?? []);

export const getAverageNavigationTime = (measures: Measure[]): number | undefined => {
  const events = collectAllEvents(measures);
  if (events.length === 0) return undefined;
  return events.reduce((sum, e) => sum + e.duration, 0) / events.length;
};

export const getSlowestNavigations = (measures: Measure[], limit = 5): NavigationEvent[] => {
  const events = collectAllEvents(measures);
  return [...events].sort((a, b) => b.duration - a.duration).slice(0, limit);
};

export interface RoutePairStats {
  average: number;
  min: number;
  max: number;
  count: number;
}

export const getNavigationStats = (
  iterations: TestCaseIterationResult[]
): Record<string, RoutePairStats> => {
  const byRoute: Record<string, number[]> = {};

  for (const iteration of iterations) {
    const events = collectAllEvents(iteration.measures);
    for (const event of events) {
      const key = `${event.from} -> ${event.to}`;
      if (!byRoute[key]) byRoute[key] = [];
      byRoute[key].push(event.duration);
    }
  }

  const stats: Record<string, RoutePairStats> = {};
  for (const [key, durations] of Object.entries(byRoute)) {
    const sum = durations.reduce((a, b) => a + b, 0);
    stats[key] = {
      average: sum / durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      count: durations.length,
    };
  }

  return stats;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest tpn --no-coverage`

Expected: All 5 tests PASS.

- [ ] **Step 5: Add re-export**

In `packages/core/reporter/src/index.ts`, add at the end:

```typescript
export * from "./reporting/tpn";
```

- [ ] **Step 6: Add TPN to ReportMetrics and Report class**

In `packages/core/reporter/src/reporting/Report.ts`, add the import:

```typescript
import { getAverageNavigationTime } from "./tpn";
```

Add to the `ReportMetrics` interface:

```typescript
interface ReportMetrics {
  runtime: number;
  fps?: number;
  cpu: number;
  totalHighCpuTime: number;
  ram?: number;
  averageNavigationTime?: number;
  averageCpuUsagePerProcess: {
    cpuUsage: number;
    processName: string;
  }[];
}
```

Add to the `getAverageMetrics` static method, inside the return object (after the `ram` line):

```typescript
averageNavigationTime: getAverageNavigationTime(averagedResult.average.measures),
```

- [ ] **Step 7: Run all reporter tests**

Run: `yarn jest reporter --no-coverage`

Expected: All tests pass. Snapshot tests may need updating if Report output changed.

- [ ] **Step 8: Commit**

```bash
git add packages/core/reporter/src/reporting/tpn.ts packages/core/reporter/src/reporting/__tests__/tpn.test.ts packages/core/reporter/src/index.ts packages/core/reporter/src/reporting/Report.ts
git commit -m "feat(reporter): add TPN reporting functions and integrate into Report"
```

---

## Task 4: Logcat TPN Parser (Profiler-Side Collection)

**Files:**

- Create: `packages/platforms/android/src/commands/tpn/pollNavigationEvents.ts`
- Create: `packages/platforms/android/src/commands/tpn/__tests__/pollNavigationEvents.test.ts`

- [ ] **Step 1: Write failing tests for the logcat TPN parser**

Create `packages/platforms/android/src/commands/tpn/__tests__/pollNavigationEvents.test.ts`:

```typescript
import { parseTPNLine, matchNavigationPairs } from "../pollNavigationEvents";

describe("parseTPNLine", () => {
  it("returns null for non-TPN lines", () => {
    expect(parseTPNLine("I/ActivityManager: some random log")).toBeNull();
  });

  it("parses a nav_start event", () => {
    const line =
      'I/ReactNativeJS: [FLASHLIGHT_TPN] {"event":"nav_start","from":"Home","to":"Profile","timestamp":1711929600123}';
    const result = parseTPNLine(line);
    expect(result).toEqual({
      event: "nav_start",
      from: "Home",
      to: "Profile",
      timestamp: 1711929600123,
    });
  });

  it("parses a nav_end event", () => {
    const line =
      'I/ReactNativeJS: [FLASHLIGHT_TPN] {"event":"nav_end","to":"Profile","timestamp":1711929600456}';
    const result = parseTPNLine(line);
    expect(result).toEqual({
      event: "nav_end",
      to: "Profile",
      timestamp: 1711929600456,
    });
  });

  it("handles malformed JSON gracefully", () => {
    const line = "I/ReactNativeJS: [FLASHLIGHT_TPN] {not valid json}";
    expect(parseTPNLine(line)).toBeNull();
  });
});

describe("matchNavigationPairs", () => {
  it("returns empty array when no events provided", () => {
    expect(matchNavigationPairs([])).toEqual([]);
  });

  it("matches a start and end pair into a NavigationEvent", () => {
    const events = [
      { event: "nav_start" as const, from: "Home", to: "Profile", timestamp: 1000 },
      { event: "nav_end" as const, to: "Profile", timestamp: 1342 },
    ];
    expect(matchNavigationPairs(events)).toEqual([
      { from: "Home", to: "Profile", startTime: 1000, endTime: 1342, duration: 342 },
    ]);
  });

  it("discards interrupted navigations when a new nav_start arrives", () => {
    const events = [
      { event: "nav_start" as const, from: "Home", to: "Profile", timestamp: 1000 },
      { event: "nav_start" as const, from: "Home", to: "Settings", timestamp: 1100 },
      { event: "nav_end" as const, to: "Settings", timestamp: 1400 },
    ];
    const result = matchNavigationPairs(events);
    expect(result).toEqual([
      { from: "Home", to: "Settings", startTime: 1100, endTime: 1400, duration: 300 },
    ]);
  });

  it("ignores nav_end without matching nav_start", () => {
    const events = [{ event: "nav_end" as const, to: "Profile", timestamp: 1342 }];
    expect(matchNavigationPairs(events)).toEqual([]);
  });

  it("ignores nav_end for a different route than pending start", () => {
    const events = [
      { event: "nav_start" as const, from: "Home", to: "Profile", timestamp: 1000 },
      { event: "nav_end" as const, to: "Settings", timestamp: 1200 },
    ];
    expect(matchNavigationPairs(events)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn jest pollNavigationEvents --no-coverage`

Expected: FAIL — module `../pollNavigationEvents` not found.

- [ ] **Step 3: Implement the TPN parser**

Create `packages/platforms/android/src/commands/tpn/pollNavigationEvents.ts`:

```typescript
import { Logger } from "@perf-profiler/logger";
import { NavigationEvent } from "@perf-profiler/types";
import { executeAsync } from "../shell";
import { ChildProcess } from "child_process";

const TPN_PREFIX = "[FLASHLIGHT_TPN]";

interface TPNStartEvent {
  event: "nav_start";
  from: string;
  to: string;
  timestamp: number;
}

interface TPNEndEvent {
  event: "nav_end";
  to: string;
  timestamp: number;
}

type TPNEvent = TPNStartEvent | TPNEndEvent;

export const parseTPNLine = (line: string): TPNEvent | null => {
  const prefixIndex = line.indexOf(TPN_PREFIX);
  if (prefixIndex === -1) return null;

  const jsonStr = line.slice(prefixIndex + TPN_PREFIX.length).trim();
  try {
    return JSON.parse(jsonStr) as TPNEvent;
  } catch {
    Logger.debug(`Failed to parse TPN event: ${jsonStr}`);
    return null;
  }
};

export const matchNavigationPairs = (events: TPNEvent[]): NavigationEvent[] => {
  const results: NavigationEvent[] = [];
  let pendingStart: TPNStartEvent | null = null;

  for (const event of events) {
    if (event.event === "nav_start") {
      pendingStart = event;
    } else if (event.event === "nav_end" && pendingStart && pendingStart.to === event.to) {
      results.push({
        from: pendingStart.from,
        to: event.to,
        startTime: pendingStart.timestamp,
        endTime: event.timestamp,
        duration: event.timestamp - pendingStart.timestamp,
      });
      pendingStart = null;
    }
  }

  return results;
};

export class NavigationEventCollector {
  private process: ChildProcess | null = null;
  private pendingEvents: TPNEvent[] = [];
  private completedEvents: NavigationEvent[] = [];

  start(): void {
    this.process = executeAsync("adb logcat -s ReactNativeJS:*", { logStderr: false });

    this.process.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        const event = parseTPNLine(line);
        if (event) {
          this.pendingEvents.push(event);
          const matched = matchNavigationPairs(this.pendingEvents);
          if (matched.length > 0) {
            this.completedEvents.push(...matched);
            this.pendingEvents = [];
          }
        }
      }
    });
  }

  flush(): NavigationEvent[] {
    const events = this.completedEvents;
    this.completedEvents = [];
    return events;
  }

  stop(): void {
    this.process?.kill("SIGINT");
    this.process = null;
    this.pendingEvents = [];
    this.completedEvents = [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn jest pollNavigationEvents --no-coverage`

Expected: All 7 tests PASS. (The `NavigationEventCollector` class uses `executeAsync` which spawns a real process — we only unit test the pure functions `parseTPNLine` and `matchNavigationPairs`.)

- [ ] **Step 5: Commit**

```bash
git add packages/platforms/android/src/commands/tpn/pollNavigationEvents.ts packages/platforms/android/src/commands/tpn/__tests__/pollNavigationEvents.test.ts
git commit -m "feat(android): add logcat TPN parser and NavigationEventCollector"
```

---

## Task 5: Integrate TPN Collection into UnixProfiler

**Files:**

- Modify: `packages/platforms/android/src/commands/platforms/UnixProfiler.ts`

- [ ] **Step 1: Import NavigationEventCollector**

At the top of `packages/platforms/android/src/commands/platforms/UnixProfiler.ts`, add import (after the existing imports around line 21):

```typescript
import { NavigationEventCollector } from "../tpn/pollNavigationEvents";
```

- [ ] **Step 2: Add collector to pollPerformanceMeasures**

In the `pollPerformanceMeasures` method (starts at line 101), add the collector initialization after the `frameTimeParser` declaration (after line 117):

```typescript
const navigationCollector = new NavigationEventCollector();
navigationCollector.start();
```

Add it to the `reset` function (after line 123):

```typescript
navigationCollector.stop();
navigationCollector.start();
```

- [ ] **Step 3: Attach TPN events to Measure**

In the `onMeasure` call (around lines 168-181), modify the Measure objects to include TPN data. Replace the `onMeasure(...)` block:

```typescript
const tpnEvents = navigationCollector.flush();
const tpn = tpnEvents.length > 0 ? tpnEvents : undefined;

onMeasure(
  this.supportFPS()
    ? {
        cpu: cpuMeasures,
        fps,
        ram,
        tpn,
        time: timestamp - initialTime,
      }
    : {
        cpu: cpuMeasures,
        ram,
        tpn,
        time: timestamp - initialTime,
      }
);
```

- [ ] **Step 4: Stop collector on profiler stop**

In the return value of `pollPerformanceMeasuresWeirdSubfunction` (around line 226-231), add cleanup. Modify the stop function:

```typescript
return {
  stop: () => {
    navigationCollector.stop();
    process.kill("SIGINT");
    this.stop();
  },
};
```

Wait — `navigationCollector` is defined in `pollPerformanceMeasures`, not `pollPerformanceMeasuresWeirdSubfunction`. Instead, stop the collector in the outer method's return. Modify `pollPerformanceMeasures` to wrap the inner return:

In `pollPerformanceMeasures`, the final `return` at line 126 calls `pollPerformanceMeasuresWeirdSubfunction`. Wrap it:

```typescript
const innerControl = this.pollPerformanceMeasuresWeirdSubfunction(
  bundleId,
  ({ pid, cpu, ram: ramStr, atrace, timestamp }) => {
    // ... existing callback body stays the same ...
  },
  () => {
    Logger.warn("Process id has changed, ignoring measures until now");
    reset();
  }
);

return {
  stop: () => {
    navigationCollector.stop();
    innerControl.stop();
  },
};
```

- [ ] **Step 5: Run existing profiler tests**

Run: `yarn jest android --no-coverage`

Expected: Tests pass. Existing tests mock child processes so the logcat spawn won't interfere.

- [ ] **Step 6: Commit**

```bash
git add packages/platforms/android/src/commands/platforms/UnixProfiler.ts
git commit -m "feat(android): integrate TPN collection into UnixProfiler polling loop"
```

---

## Task 6: Navigation Tracker SDK Package

**Files:**

- Create: `packages/plugins/navigation-tracker/package.json`
- Create: `packages/plugins/navigation-tracker/tsconfig.json`
- Create: `packages/plugins/navigation-tracker/src/index.ts`
- Create: `packages/plugins/navigation-tracker/src/__tests__/navigationTracker.test.ts`

- [ ] **Step 1: Create package.json**

Create `packages/plugins/navigation-tracker/package.json`:

```json
{
  "name": "@flashlight/navigation-tracker",
  "version": "0.1.0",
  "description": "Auto-instruments React Navigation to emit TPN markers for Flashlight",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "scripts": {
    "test": "jest"
  },
  "license": "MIT",
  "peerDependencies": {
    "react": ">=16.8.0",
    "react-native": ">=0.60.0",
    "@react-navigation/native": ">=5.0.0"
  },
  "devDependencies": {
    "react": "^18.0.0",
    "@react-navigation/native": "^6.0.0",
    "@types/react": "^18.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/plugins/navigation-tracker/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.module.json",
  "compilerOptions": {
    "outDir": "./dist",
    "jsx": "react"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 3: Write failing tests**

Create `packages/plugins/navigation-tracker/src/__tests__/navigationTracker.test.ts`:

```typescript
import { formatTPNEvent, getRouteName } from "../index";

describe("formatTPNEvent", () => {
  it("formats a nav_start event", () => {
    const result = formatTPNEvent({
      event: "nav_start",
      from: "Home",
      to: "Profile",
      timestamp: 1000,
    });
    expect(result).toBe(
      '[FLASHLIGHT_TPN] {"event":"nav_start","from":"Home","to":"Profile","timestamp":1000}'
    );
  });

  it("formats a nav_end event", () => {
    const result = formatTPNEvent({
      event: "nav_end",
      to: "Profile",
      timestamp: 1342,
    });
    expect(result).toBe('[FLASHLIGHT_TPN] {"event":"nav_end","to":"Profile","timestamp":1342}');
  });
});

describe("getRouteName", () => {
  it("extracts the active route name from a navigation state", () => {
    const state = {
      index: 1,
      routes: [
        { name: "Home", key: "home-1" },
        { name: "Profile", key: "profile-1" },
      ],
    };
    expect(getRouteName(state)).toBe("Profile");
  });

  it("handles nested navigators", () => {
    const state = {
      index: 0,
      routes: [
        {
          name: "MainTabs",
          key: "tabs-1",
          state: {
            index: 1,
            routes: [
              { name: "Feed", key: "feed-1" },
              { name: "Settings", key: "settings-1" },
            ],
          },
        },
      ],
    };
    expect(getRouteName(state)).toBe("Settings");
  });

  it("returns undefined for empty state", () => {
    expect(getRouteName(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `yarn jest navigationTracker --no-coverage`

Expected: FAIL — module `../index` not found.

- [ ] **Step 5: Implement the SDK**

Create `packages/plugins/navigation-tracker/src/index.ts`:

```typescript
import React, { useRef, useCallback } from "react";

const TPN_PREFIX = "[FLASHLIGHT_TPN]";

type TPNStartPayload = {
  event: "nav_start";
  from: string;
  to: string;
  timestamp: number;
};

type TPNEndPayload = {
  event: "nav_end";
  to: string;
  timestamp: number;
};

type TPNPayload = TPNStartPayload | TPNEndPayload;

export const formatTPNEvent = (payload: TPNPayload): string =>
  `${TPN_PREFIX} ${JSON.stringify(payload)}`;

interface NavigationState {
  index: number;
  routes: {
    name: string;
    key: string;
    state?: NavigationState;
  }[];
}

export const getRouteName = (state: NavigationState | undefined): string | undefined => {
  if (!state) return undefined;
  const route = state.routes[state.index];
  if (route.state) return getRouteName(route.state);
  return route.name;
};

const emitTPN = (payload: TPNPayload): void => {
  console.log(formatTPNEvent(payload));
};

type NavigationContainerProps = {
  onStateChange?: (state: NavigationState | undefined) => void;
  [key: string]: unknown;
};

type NavigationContainerComponent = React.ComponentType<NavigationContainerProps>;

export const withNavigationTracker = <P extends NavigationContainerProps>(
  NavigationContainer: React.ComponentType<P>
): React.ComponentType<P> => {
  const TrackedContainer = React.forwardRef<unknown, P>((props, ref) => {
    const previousRouteRef = useRef<string | undefined>(undefined);

    const handleStateChange = useCallback(
      (state: NavigationState | undefined) => {
        const currentRoute = getRouteName(state);

        if (currentRoute && currentRoute !== previousRouteRef.current) {
          const from = previousRouteRef.current ?? "Initial";
          const timestamp = Date.now();

          emitTPN({ event: "nav_start", from, to: currentRoute, timestamp });

          // Wait for interactions and next frame paint to signal render complete
          const { InteractionManager } = require("react-native");
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
              emitTPN({ event: "nav_end", to: currentRoute, timestamp: Date.now() });
            });
          });

          previousRouteRef.current = currentRoute;
        }

        props.onStateChange?.(state);
      },
      [props.onStateChange]
    );

    return React.createElement(NavigationContainer, {
      ...props,
      ref,
      onStateChange: handleStateChange,
    } as P);
  });

  TrackedContainer.displayName = "NavigationTrackerContainer";
  return TrackedContainer as unknown as React.ComponentType<P>;
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn jest navigationTracker --no-coverage`

Expected: All 5 tests PASS.

- [ ] **Step 7: Add package to root tsconfig project references**

In `tsconfig.json` at root, add to the `references` array:

```json
{ "path": "packages/plugins/navigation-tracker" }
```

- [ ] **Step 8: Commit**

```bash
git add packages/plugins/navigation-tracker/
git commit -m "feat: add @flashlight/navigation-tracker SDK package"
```

---

## Task 7: TPN Bar Chart UI Component

**Files:**

- Create: `packages/core/web-reporter-ui/src/sections/TPNReport.tsx`

- [ ] **Step 1: Create the TPNReport component**

Create `packages/core/web-reporter-ui/src/sections/TPNReport.tsx`:

```tsx
import React from "react";
import { AveragedTestCaseResult, NavigationEvent } from "@perf-profiler/types";
import { Chart } from "../components/Charts/Chart";
import { roundToDecimal } from "@perf-profiler/reporter";

const getBarColor = (duration: number): string => {
  if (duration < 200) return "#158000";
  if (duration < 500) return "#E6A700";
  return "#E62E2E";
};

const collectEvents = (results: AveragedTestCaseResult[]): NavigationEvent[] =>
  results.flatMap((result) => result.average.measures.flatMap((m) => m.tpn ?? []));

export const TPNReport = ({ results }: { results: AveragedTestCaseResult[] }) => {
  const events = collectEvents(results);

  if (events.length === 0) {
    throw new Error("No TPN data");
  }

  const series = [
    {
      name: "Navigation Time",
      data: events.map((event) => ({
        x: `${event.from} -> ${event.to}`,
        y: roundToDecimal(event.duration, 0),
        fillColor: getBarColor(event.duration),
      })),
    },
  ];

  const options = {
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
      },
    },
    xaxis: {
      title: {
        text: "Duration (ms)",
        style: { color: "#FFFFFF99" },
      },
    },
    yaxis: {
      labels: {
        maxWidth: 250,
      },
    },
    tooltip: {
      y: {
        formatter: (val: number) => `${val}ms`,
      },
    },
    legend: {
      show: false,
    },
    dataLabels: {
      enabled: true,
      formatter: (val: number) => `${val}ms`,
      style: {
        colors: ["#FFFFFF"],
      },
    },
  };

  return (
    <Chart
      type="bar"
      title="Time Per Navigation (TPN)"
      series={series}
      height={Math.max(300, events.length * 50)}
      options={options}
    />
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/web-reporter-ui/src/sections/TPNReport.tsx
git commit -m "feat(web-reporter-ui): add TPNReport horizontal bar chart component"
```

---

## Task 8: Integrate TPNReport into ReporterView

**Files:**

- Modify: `packages/core/web-reporter-ui/ReporterView.tsx`

- [ ] **Step 1: Add TPNReport import**

In `packages/core/web-reporter-ui/ReporterView.tsx`, add import after the RAMReport import (around line 4):

```typescript
import { TPNReport } from "./src/sections/TPNReport";
```

- [ ] **Step 2: Add TPNReport section to the report**

In `ReporterView.tsx`, after the RAMReport section block (after line 84 `</div>` and before `<div className="h-10" />`), add:

```tsx
                <div className="h-10" />

                <HideSectionIfUndefinedValueFound>
                  <div className="mx-8 p-6 bg-dark-charcoal border border-gray-800 rounded-lg">
                    <TPNReport results={averagedResults} />
                  </div>
                </HideSectionIfUndefinedValueFound>
```

The full section after RAMReport should look like:

```tsx
                <div className="mx-8 p-6 bg-dark-charcoal border border-gray-800 rounded-lg">
                  <RAMReport results={averagedResults} />
                </div>
                <div className="h-10" />

                <HideSectionIfUndefinedValueFound>
                  <div className="mx-8 p-6 bg-dark-charcoal border border-gray-800 rounded-lg">
                    <TPNReport results={averagedResults} />
                  </div>
                </HideSectionIfUndefinedValueFound>
```

- [ ] **Step 3: Run web-reporter-ui tests**

Run: `yarn jest web-reporter-ui --no-coverage`

Expected: Tests pass. Snapshot tests may need updating since we added a new section.

- [ ] **Step 4: Update snapshots if needed**

Run: `yarn jest web-reporter-ui --no-coverage -u`

- [ ] **Step 5: Run full test suite**

Run: `yarn jest --no-coverage`

Expected: All tests pass across the entire project.

- [ ] **Step 6: Commit**

```bash
git add packages/core/web-reporter-ui/ReporterView.tsx
git commit -m "feat(web-reporter-ui): integrate TPNReport into ReporterView"
```

---

## Task 9: Build Verification

- [ ] **Step 1: Run full build**

Run: `yarn build`

Expected: Build completes without errors.

- [ ] **Step 2: Run full test suite**

Run: `yarn test`

Expected: Prettier, ESLint, build, and Jest all pass.

- [ ] **Step 3: Commit any remaining fixes**

If any lint/format fixes are needed:

```bash
git add -A
git commit -m "chore: fix lint and format issues"
```
