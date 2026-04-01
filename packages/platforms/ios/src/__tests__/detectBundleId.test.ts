import { parseSimulatorApps, parseDevicectlApps } from "../detectBundleId";

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

describe("parseDevicectlApps", () => {
  it("parses devicectl app listing output", () => {
    const output = `Apps installed:
Name              Bundle Identifier      Version   Bundle Version
---------------   --------------------   -------   --------------
Clary             com.clary.so           1.8.0     74
Clary (Dev)       com.clary.so.dev       1.9.0     1
Clary (Preview)   com.clary.so.preview   1.9.0     1
bcause            com.bcause.everyone    1.9       2`;
    const result = parseDevicectlApps(output);
    expect(result).toEqual([
      "com.clary.so",
      "com.clary.so.dev",
      "com.clary.so.preview",
      "com.bcause.everyone",
    ]);
  });

  it("returns empty array for empty output", () => {
    expect(parseDevicectlApps("")).toEqual([]);
  });

  it("returns empty array when no apps listed", () => {
    const output = `Apps installed:
Name   Bundle Identifier   Version   Bundle Version
----   -----------------   -------   --------------`;
    const result = parseDevicectlApps(output);
    expect(result).toEqual([]);
  });
});
