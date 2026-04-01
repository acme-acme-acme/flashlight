import { parseSimulatorApps, parsePyideviceAppList } from "../detectBundleId";

describe("parseSimulatorApps", () => {
  it("parses xcrun simctl listapps plist output and returns bundle IDs", () => {
    const output = `{
    "com.example.myapp" =     {
        ApplicationType = User;
        Bundle = "myapp.app";
        BundleIdentifier = "com.example.myapp";
        CFBundleDisplayName = "MyApp";
        CFBundleName = "MyApp";
    };
    "com.apple.mobilesafari" =     {
        ApplicationType = System;
        Bundle = "MobileSafari.app";
        BundleIdentifier = "com.apple.mobilesafari";
        CFBundleDisplayName = Safari;
        CFBundleName = Safari;
    };
}`;
    const result = parseSimulatorApps(output);
    expect(result).toEqual(["com.example.myapp"]);
  });

  it("returns empty array when no user apps found", () => {
    const output = `{
    "com.apple.mobilesafari" =     {
        ApplicationType = System;
        BundleIdentifier = "com.apple.mobilesafari";
    };
}`;
    const result = parseSimulatorApps(output);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty output", () => {
    expect(parseSimulatorApps("")).toEqual([]);
  });
});

describe("parsePyideviceAppList", () => {
  it("parses pyidevice app list output", () => {
    const output = `com.example.myapp
com.example.otherapp`;
    const result = parsePyideviceAppList(output);
    expect(result).toEqual(["com.example.myapp", "com.example.otherapp"]);
  });

  it("filters empty lines", () => {
    const output = `com.example.myapp

com.example.otherapp
`;
    const result = parsePyideviceAppList(output);
    expect(result).toEqual(["com.example.myapp", "com.example.otherapp"]);
  });

  it("returns empty array for empty output", () => {
    expect(parsePyideviceAppList("")).toEqual([]);
  });
});
