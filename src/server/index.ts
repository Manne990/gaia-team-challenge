import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { migrate, openDatabase } from "./database/database.js";

async function start() {
  const config = loadConfig();
  const database = openDatabase(config.databasePath);
  migrate(database);
  const app = createApp(database);
  if (config.environment === "production") {
    const clientDirectory = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../client",
    );
    if (!existsSync(clientDirectory))
      throw new Error(
        `Production client build not found at ${clientDirectory}`,
      );
    const clientIndex = readFileSync(
      resolve(clientDirectory, "index.html"),
      "utf8",
    );
    app.use(express.static(clientDirectory));
    app.get("/*path", (_request, response) =>
      response.type("html").send(clientIndex),
    );
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: resolve(process.cwd(), "src/client"),
      server: {
        middlewareMode: true,
        hmr: process.env.NORTHSTAR_TEST_MODE === "1" ? false : undefined,
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  const server = app.listen(config.port, config.host, () => {
    console.log(
      `Northstar CRM listening on http://${config.host}:${config.port}`,
    );
    console.log(`SQLite database: ${config.databasePath}`);
  });
  const shutdown = () =>
    server.close(() => {
      database.close();
      process.exit(0);
    });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
start().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Unexpected startup failure",
  );
  process.exit(1);
});
