export const DEFAULT_PORT = 4000;

export const getWebAppUrl = (port: number = DEFAULT_PORT) => {
  if (process.env.DEVELOPMENT_MODE === "true") {
    return "http://localhost:4000";
  }
  return `http://localhost:${port}`;
};
