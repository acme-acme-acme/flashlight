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
