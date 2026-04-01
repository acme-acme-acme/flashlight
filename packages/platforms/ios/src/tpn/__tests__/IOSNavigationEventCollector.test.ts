import { IOSNavigationEventCollector } from "../IOSNavigationEventCollector";
import { ChildProcess, exec, execSync } from "child_process";
import { EventEmitter } from "events";
import { Readable } from "stream";

// Mock child_process.exec
jest.mock("child_process", () => ({
  exec: jest.fn(),
  execSync: jest.fn(),
}));

const createMockProcess = (): ChildProcess => {
  const proc = new EventEmitter() as ChildProcess;
  proc.stdout = new EventEmitter() as unknown as Readable;
  proc.stderr = new EventEmitter() as unknown as Readable;
  proc.kill = jest.fn();
  return proc;
};

describe("IOSNavigationEventCollector", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("starts log stream process for simulator", () => {
    (execSync as unknown as jest.Mock).mockReturnValue("booted-device-udid\n");
    const mockProc = createMockProcess();
    (exec as unknown as jest.Mock).mockReturnValue(mockProc);

    const collector = new IOSNavigationEventCollector("simulator");
    collector.start();

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining("xcrun simctl spawn booted log stream")
    );
  });

  it("starts syslog process for physical device", () => {
    const mockProc = createMockProcess();
    (exec as unknown as jest.Mock).mockReturnValue(mockProc);

    const collector = new IOSNavigationEventCollector("device");
    collector.start();

    expect(exec).toHaveBeenCalledWith(expect.stringContaining("pyidevice syslog"));
  });

  it("collects and flushes TPN events", () => {
    const mockProc = createMockProcess();
    (exec as unknown as jest.Mock).mockReturnValue(mockProc);

    const collector = new IOSNavigationEventCollector("device");
    collector.start();

    // Simulate log data with a complete navigation pair
    mockProc.stdout!.emit(
      "data",
      Buffer.from(
        '[FLASHLIGHT_TPN] {"event":"nav_start","from":"Home","to":"Profile","timestamp":1000}\n' +
          '[FLASHLIGHT_TPN] {"event":"nav_end","to":"Profile","timestamp":1300}\n'
      )
    );

    const events = collector.flush();
    expect(events).toEqual([
      { from: "Home", to: "Profile", startTime: 1000, endTime: 1300, duration: 300 },
    ]);
  });

  it("returns empty array when no events collected", () => {
    const mockProc = createMockProcess();
    (exec as unknown as jest.Mock).mockReturnValue(mockProc);

    const collector = new IOSNavigationEventCollector("device");
    collector.start();

    expect(collector.flush()).toEqual([]);
  });

  it("kills process on stop", () => {
    const mockProc = createMockProcess();
    (exec as unknown as jest.Mock).mockReturnValue(mockProc);

    const collector = new IOSNavigationEventCollector("device");
    collector.start();
    collector.stop();

    expect(mockProc.kill).toHaveBeenCalledWith("SIGINT");
  });
});
