import React from "react";
import { TextField } from "./TextField";
import { Button } from "@perf-profiler/web-reporter-ui";
import { DetectedPlatform } from "../../server/socket/socketInterface";

export const BundleIdSelector = ({
  bundleId,
  onChange,
  autodetect,
  platform,
}: {
  bundleId: string | null;
  onChange: (bundleId: string) => void;
  autodetect: () => void;
  platform: DetectedPlatform;
}) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <>
      <Button onClick={autodetect}>Auto-Detect</Button>
      <div style={{ paddingRight: 5, paddingLeft: 5 }}>
        <TextField onChange={handleChange} value={bundleId || ""} platform={platform} />
      </div>
    </>
  );
};
