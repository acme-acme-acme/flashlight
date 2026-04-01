import { detectPlatform } from "../detectPlatform";
import { execSync } from "child_process";

jest.mock("child_process", () => ({
  execSync: jest.fn(),
}));

const mockExecSync = execSync as unknown as jest.Mock;

describe("detectPlatform", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.PLATFORM;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns env var override when PLATFORM is set to ios", () => {
    process.env.PLATFORM = "ios";
    expect(detectPlatform()).toBe("ios");
  });

  it("returns env var override when PLATFORM is set to android", () => {
    process.env.PLATFORM = "android";
    expect(detectPlatform()).toBe("android");
  });

  it("returns env var override when PLATFORM is set to flashlight", () => {
    process.env.PLATFORM = "flashlight";
    expect(detectPlatform()).toBe("flashlight");
  });

  it("detects iOS when simulator is booted and no Android device", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("xcrun simctl")) return "iPhone 15 (ABCD-1234) (Booted)\n";
      if (cmd.includes("adb devices")) return "List of devices attached\n\n";
      throw new Error("unknown command");
    });

    expect(detectPlatform()).toBe("ios");
  });

  it("detects Android when adb device connected and no iOS", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("xcrun simctl")) return "\n";
      if (cmd.includes("devicectl list"))
        return "Name   Hostname   Identifier   State   Model\n----   --------   ----------   -----   -----\n";
      if (cmd.includes("adb devices")) return "List of devices attached\nemulator-5554\tdevice\n";
      throw new Error("unknown command");
    });

    expect(detectPlatform()).toBe("android");
  });

  it("detects iOS physical device via devicectl", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("xcrun simctl")) return "\n";
      if (cmd.includes("devicectl list"))
        return "Name   Hostname   Identifier   State       Model\n----   --------   ----------   ---------   -----\niPhone   host.local   ABCD-1234   connected   iPhone 16\n";
      if (cmd.includes("adb devices")) return "List of devices attached\n\n";
      throw new Error("unknown command");
    });

    expect(detectPlatform()).toBe("ios");
  });

  it("throws when both platforms detected and no PLATFORM env var", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("xcrun simctl")) return "iPhone 15 (ABCD-1234) (Booted)\n";
      if (cmd.includes("adb devices")) return "List of devices attached\nemulator-5554\tdevice\n";
      throw new Error("unknown command");
    });

    expect(() => detectPlatform()).toThrow("Both iOS and Android devices detected");
  });

  it("defaults to android when no devices detected", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("xcrun simctl")) return "\n";
      if (cmd.includes("devicectl list"))
        return "Name   Hostname   Identifier   State   Model\n----   --------   ----------   -----   -----\n";
      if (cmd.includes("adb devices")) return "List of devices attached\n\n";
      throw new Error("unknown command");
    });

    expect(detectPlatform()).toBe("android");
  });
});
