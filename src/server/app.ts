import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { BootstrapResponse, ErrorResponse } from "../shared/api.js";
import { AuthService, createAuthHttpHandler } from "./auth/index.js";

export function createApp(
  databaseOrRoutes?: Database.Database | ((app: Express) => void),
) {
  const database =
    typeof databaseOrRoutes === "function" ? undefined : databaseOrRoutes;
  const configureRoutes =
    typeof databaseOrRoutes === "function" ? databaseOrRoutes : undefined;
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.setHeader("x-request-id", response.locals.requestId as string);
    next();
  });
  if (database) {
    const authHandler = createAuthHttpHandler(new AuthService(database));
    app.use((request, response, next) => {
      void authHandler(request, response)
        .then((handled) => {
          if (!handled) next();
        })
        .catch(next);
    });
  }
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (_request, response) =>
    response.json({ status: "ok" }),
  );
  app.get("/api/bootstrap", (_request, response) => {
    const payload: BootstrapResponse = {
      product: "Northstar CRM",
      status: "ready",
    };
    response.json(payload);
  });
  configureRoutes?.(app);
  app.use("/api", (_request, response) => {
    const payload: ErrorResponse = {
      error: {
        code: "NOT_FOUND",
        message: "The requested API endpoint does not exist.",
        requestId: response.locals.requestId as string,
      },
    };
    response.status(404).json(payload);
  });
  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const requestId = response.locals.requestId as string;
    console.error("Unexpected request failure", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown failure",
    });
    const payload: ErrorResponse = {
      error: {
        code: "UNEXPECTED_ERROR",
        message: "The request could not be completed. Try again.",
        requestId,
      },
    };
    response.status(500).json(payload);
  };
  app.use(errorHandler);
  return app;
}
