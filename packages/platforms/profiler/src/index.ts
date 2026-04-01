import { AndroidProfiler, FlashlightSelfProfiler } from "@perf-profiler/android";
import { IOSProfiler } from "@perf-profiler/ios";
import { Profiler } from "@perf-profiler/types";
import { detectPlatform } from "./detectPlatform";

const getProfiler = (): Profiler => {
  const platform = detectPlatform();
  switch (platform) {
    case "ios":
      return new IOSProfiler();
    case "flashlight":
      return new FlashlightSelfProfiler();
    default:
      return new AndroidProfiler();
  }
};

export const profiler: Profiler = getProfiler();

// TODO move this to a separate package
export { waitFor } from "@perf-profiler/android";
