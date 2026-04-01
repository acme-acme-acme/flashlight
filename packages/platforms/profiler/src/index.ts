import { AndroidProfiler, FlashlightSelfProfiler } from "@perf-profiler/android";
import { IOSProfiler } from "@perf-profiler/ios";
import { Profiler } from "@perf-profiler/types";
import { detectPlatform, Platform } from "./detectPlatform";

export type { Platform };

const _detectedPlatform = detectPlatform();

const getProfiler = (platform: Platform): Profiler => {
  switch (platform) {
    case "ios":
      return new IOSProfiler();
    case "flashlight":
      return new FlashlightSelfProfiler();
    default:
      return new AndroidProfiler();
  }
};

export const detectedPlatform: Platform = _detectedPlatform;
export const profiler: Profiler = getProfiler(_detectedPlatform);

// TODO move this to a separate package
export { waitFor } from "@perf-profiler/android";
