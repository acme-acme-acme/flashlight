#!/usr/bin/env node

import { program } from "commander";
import { DEFAULT_PORT } from "./constants";

program
  .command("measure")
  .summary("Measure performance of a mobile app")
  .description(
    `Measure performance of a mobile app. Display the results live in a web app.
Platform is auto-detected from connected devices. Set PLATFORM env var to override.

Main usage:
flashlight measure`
  )
  .option("-p, --port [port]", "Specify the port number for the server")
  .option(
    "--bundleId <bundleId>",
    "Bundle id of the app to measure (auto-detected on Android, recommended on iOS)"
  )
  .action(async (options) => {
    const port = Number(options.port) || DEFAULT_PORT;
    // measure command can be a bit slow to load since we run ink, express and socket.io, so lazy load it
    const { runServerApp } = await import("./ServerApp");
    runServerApp(port);
  });

program.parse();
