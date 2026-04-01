import React from "react";
import { AveragedTestCaseResult, NavigationEvent } from "@perf-profiler/types";
import { Chart } from "../components/Charts/Chart";
import { roundToDecimal } from "@perf-profiler/reporter";

const getBarColor = (duration: number): string => {
  if (duration < 200) return "#158000";
  if (duration < 500) return "#E6A700";
  return "#E62E2E";
};

const collectEvents = (results: AveragedTestCaseResult[]): NavigationEvent[] =>
  results.flatMap((result) => result.average.measures.flatMap((m) => m.tpn ?? []));

export const TPNReport = ({ results }: { results: AveragedTestCaseResult[] }) => {
  const events = collectEvents(results);

  if (events.length === 0) {
    throw new Error("No TPN data");
  }

  const series = [
    {
      name: "Navigation Time",
      data: events.map((event) => ({
        x: `${event.from} -> ${event.to}`,
        y: roundToDecimal(event.duration, 0),
        fillColor: getBarColor(event.duration),
      })),
    },
  ];

  const options = {
    plotOptions: {
      bar: {
        horizontal: true,
        distributed: true,
      },
    },
    xaxis: {
      title: {
        text: "Duration (ms)",
        style: { color: "#FFFFFF99" },
      },
    },
    yaxis: {
      labels: {
        maxWidth: 250,
      },
    },
    tooltip: {
      y: {
        formatter: (val: number) => `${val}ms`,
      },
    },
    legend: {
      show: false,
    },
    dataLabels: {
      enabled: true,
      formatter: (val: number) => `${val}ms`,
      style: {
        colors: ["#FFFFFF"],
      },
    },
  };

  return (
    <Chart
      type="bar"
      title="Time Per Navigation (TPN)"
      series={series}
      height={Math.max(300, events.length * 50)}
      options={options}
    />
  );
};
