import React from "react";
import { AveragedTestCaseResult, NavigationEvent } from "@perf-profiler/types";
import { Chart } from "../components/Charts/Chart";
import { roundToDecimal } from "@perf-profiler/reporter";
import { NoValueFound } from "./hideSectionForEmptyValue";

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
    throw new NoValueFound();
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
        distributed: true,
        columnWidth: "60%",
      },
    },
    xaxis: {
      labels: {
        rotate: -45,
        rotateAlways: true,
        style: { colors: "#FFFFFF99" },
      },
    },
    yaxis: {
      title: {
        text: "Duration (ms)",
        style: { color: "#FFFFFF99" },
      },
      labels: {
        style: { colors: "#FFFFFF99" },
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
      height={500}
      options={options}
    />
  );
};
