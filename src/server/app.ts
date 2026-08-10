import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { BootstrapResponse, ErrorResponse } from "../shared/api.js";
import { AuthService, createAuthHttpHandler } from "./auth/index.js";
import { registerContactRoutes } from "./contacts/index.js";
import { registerImportRoutes } from "./imports/http.js";
import { CompanyService, createCompanyHttpHandler } from "./companies/index.js";
import { registerDealRoutes } from "./deals/index.js";
import { createTaskHttpHandler, TaskService } from "./tasks/index.js";
import { registerActivityRoutes } from "./activities/index.js";

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
    const auth = new AuthService(database);
    const authHandler = createAuthHttpHandler(auth);
    const companyHandler = createCompanyHttpHandler(
      auth,
      new CompanyService(database),
    );
    const taskHandler = createTaskHttpHandler(auth, new TaskService(database));
    app.use((request, response, next) => {
      void authHandler(request, response)
        .then((handled) => {
          if (handled) return;
          return companyHandler(request, response).then((companyHandled) => {
            if (companyHandled) return;
            return taskHandler(request, response).then((taskHandled) => {
              if (!taskHandled) next();
            });
          });
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
  if (database) registerContactRoutes(app, database);
  if (database) registerDealRoutes(app, database);
  if (database) registerActivityRoutes(app, database);
  if (database) registerImportRoutes(app, database);
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
