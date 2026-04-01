# Design: Default Port Change & TimePerNavigation (TPN) Metric

**Date:** 2026-04-01
**Status:** Approved

## Overview

Two features for flashlight:

1. Change the default server port from 3000 to 4000
2. Add a new TPN (TimePerNavigation) metric that measures how long it takes to navigate between routes in a mobile app

---

## Feature 1: Default Port Change

### Changes

- `packages/commands/measure/src/server/constants.ts`: Change `DEFAULT_PORT` from `3000` to `4000`
- `packages/commands/measure/src/webapp/index.html`: Update hardcoded placeholder from `localhost:3000` to `localhost:4000`
- The existing `--port` / `-p` CLI flag continues to work as an override

---

## Feature 2: TPN (TimePerNavigation) Metric

### Architecture: Approach A — Separate Event Channel via Logcat

Navigation timing is captured through structured logcat markers emitted by a lightweight SDK in the user's app. The flashlight profiler reads these markers via a parallel logcat process and integrates them into the existing metrics pipeline.

### Component 1: SDK (`@flashlight/navigation-tracker`)

A pure-JavaScript React Native package. No native modules required.

**User setup (one-time):**

```tsx
import { withNavigationTracker } from "@flashlight/navigation-tracker";

const TrackedContainer = withNavigationTracker(NavigationContainer);
// use <TrackedContainer> instead of <NavigationContainer>
```

**How it works:**

- Hooks into React Navigation's `onStateChange` to detect navigation start + source/target route names
- Uses `InteractionManager.runAfterInteractions()` + `requestAnimationFrame` to detect when the destination screen has rendered
- Emits structured log lines via `console.log` (which writes to logcat on Android):

```
[FLASHLIGHT_TPN] {"event":"nav_start","from":"Home","to":"Profile","timestamp":1711929600123}
[FLASHLIGHT_TPN] {"event":"nav_end","to":"Profile","timestamp":1711929600456}
```

**Scope:** Android first (logcat). iOS support can follow the same pattern via os_log later.

### Component 2: Profiler-Side TPN Collection

**New file:** `packages/platforms/android/src/commands/tpn/pollNavigationEvents.ts`

- Spawns `adb logcat -s ReactNativeJS:*` as a long-running process alongside the existing C++ profiler
- Parses lines with the `[FLASHLIGHT_TPN]` prefix
- Matches `nav_start` / `nav_end` pairs by route name
- Produces `NavigationEvent[]` per polling interval

**Type changes in `@perf-profiler/types`:**

```typescript
export interface NavigationEvent {
  from: string;
  to: string;
  startTime: number; // absolute ms timestamp
  endTime: number;
  duration: number; // endTime - startTime in ms
}

export interface Measure {
  cpu: CpuMeasure;
  ram?: number;
  fps?: number;
  tpn?: NavigationEvent[]; // NEW
  time: number;
}
```

Navigation events are attached to whichever `Measure` polling interval they complete in (i.e., when `nav_end` is received).

### Component 3: Reporting & Statistics

**New file:** `packages/core/reporter/src/reporting/tpn.ts`

- `getAverageNavigationTime(measures)` — average duration across all `NavigationEvent`s in a test run
- `getNavigationStats(iterations)` — min/max, standard deviation, variation coefficient per route pair (e.g., "Home -> Profile" stats separately from "Profile -> Settings")
- `getSlowestNavigations(measures)` — top N slowest navigations for bottleneck identification

**Report metrics** — `ReportMetrics` gets new optional fields:

```typescript
averageNavigationTime?: number;  // average TPN in ms
navigationEvents?: NavigationEvent[];  // all events for detailed view
```

**Score impact:** TPN does NOT affect the existing performance score. The score formula is CPU + FPS based and well-established. Navigation time is app-specific (500ms might be fine for a complex screen but terrible for a simple one). TPN is presented as standalone data for the developer to interpret.

### Component 4: Web UI — TPN Report Chart

**New file:** `packages/core/web-reporter-ui/src/sections/TPNReport.tsx`

- **Chart type:** Horizontal bar chart (not line chart). Each bar = one navigation event, length = duration in ms.
- Bars labeled with route transition (e.g., "Home -> Profile: 342ms")
- Grouped by route pair across iterations for consistency comparison
- Color coding: green (<200ms), yellow (200-500ms), red (>500ms)

**Integration into `ReporterView.tsx`:**

- Added as a new section after RAMReport
- Wrapped in `HideSectionIfUndefinedValueFound` — gracefully hidden when no TPN data exists
- Existing reports without the SDK installed simply don't show the section

**Live measure view:**

- The measure command's WebSocket feed already pushes `Measure` objects. Since `tpn` is a new optional field on `Measure`, navigation events flow through the existing pipeline automatically — no socket layer changes needed.

---

## Data Flow Summary

```
[App with SDK]
  NavigationContainer onStateChange
    -> nav_start log via console.log
    -> InteractionManager + rAF
    -> nav_end log via console.log

[Android logcat]
  adb logcat -s ReactNativeJS:*
    -> pollNavigationEvents.ts parses [FLASHLIGHT_TPN] lines
    -> Matches start/end pairs by route name
    -> Produces NavigationEvent[]

[Profiler polling loop]
  Every 500ms:
    -> Existing: CPU, FPS, RAM
    -> New: attach pending NavigationEvent[] to Measure.tpn

[Report generation]
  -> tpn.ts computes averages, stats, slowest navigations
  -> ReportMetrics includes averageNavigationTime

[Web UI]
  -> TPNReport.tsx renders horizontal bar chart
  -> Color-coded by duration threshold
  -> Hidden when no TPN data present
```

---

## Out of Scope

- iOS support (future work, same pattern via os_log)
- TPN impact on performance score
- Nested/concurrent navigation handling: if a `nav_start` arrives while a previous navigation to a different route is still pending (no `nav_end` yet), the previous navigation is discarded as interrupted. This is simple and correct for the common case; concurrent navigation is rare in practice.
