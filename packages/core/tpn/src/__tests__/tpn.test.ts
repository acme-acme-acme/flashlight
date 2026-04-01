import { parseTPNLine, matchNavigationPairs } from "../index";

describe("parseTPNLine", () => {
  it("returns null for non-TPN lines", () => {
    expect(parseTPNLine("I/ActivityManager: some random log")).toBeNull();
  });

  it("parses a nav_start event from Android logcat format", () => {
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

  it("parses a nav_end event from Android logcat format", () => {
    const line =
      'I/ReactNativeJS: [FLASHLIGHT_TPN] {"event":"nav_end","to":"Profile","timestamp":1711929600456}';
    const result = parseTPNLine(line);
    expect(result).toEqual({
      event: "nav_end",
      to: "Profile",
      timestamp: 1711929600456,
    });
  });

  it("parses TPN events from iOS log stream format", () => {
    const line =
      '2026-04-01 12:00:00.000 Df com.facebook.react.log 0x1234 [FLASHLIGHT_TPN] {"event":"nav_start","from":"Home","to":"Settings","timestamp":1000}';
    const result = parseTPNLine(line);
    expect(result).toEqual({
      event: "nav_start",
      from: "Home",
      to: "Settings",
      timestamp: 1000,
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
