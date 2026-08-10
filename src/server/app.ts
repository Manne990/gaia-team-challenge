import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import type { BootstrapResponse, ErrorResponse } from "../shared/api.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((_request, response, next) => {
    response.locals.requestId = randomUUID();
    response.setHeader("x-request-id", response.locals.requestId as string);
    next();
  });
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
  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    const requestId = response.locals.requestId as string;
    console.error("Unexpected request failure", { requestId, error });
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
