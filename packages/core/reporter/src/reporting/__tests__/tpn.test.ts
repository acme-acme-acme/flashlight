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
