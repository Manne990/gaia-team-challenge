import type Database from "better-sqlite3";
import type { Express, NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
} from "../auth/service.js";
import { sessionToken } from "../auth/http.js";
import {
  ImportConflictError,
  ImportExportService,
  ImportNotFoundError,
  ImportValidationError,
} from "./service.js";

export function registerImportRoutes(
  app: Express,
  database: Database.Database,
) {
  const auth = new AuthService(database);
  const service = new ImportExportService(database, auth);
  const identity = (request: Request) =>
    auth.authenticate(sessionToken(request));
  const route =
    (operation: (request: Request, response: Response) => void) =>
    (request: Request, response: Response, next: NextFunction) => {
      try {
        operation(request, response);
      } catch (error) {
        if (error instanceof AuthenticationError)
          response.status(401).json({
            error: "UNAUTHENTICATED",
            message: "Authentication required.",
          });
        else if (error instanceof AuthorizationError)
          response
            .status(403)
            .json({ error: "FORBIDDEN", message: error.message });
        else if (error instanceof ImportNotFoundError)
          response
            .status(404)
            .json({ error: "NOT_FOUND", message: "Import not found." });
        else if (error instanceof ImportConflictError)
          response
            .status(409)
            .json({ error: "IMPORT_CONFLICT", message: error.message });
        else if (
          error instanceof ImportValidationError ||
          error instanceof ZodError
        )
          response.status(400).json({
            error: "VALIDATION_ERROR",
            message: error instanceof Error ? error.message : "Invalid import.",
          });
        else next(error);
      }
    };
  app.post(
    "/api/imports/preview",
    expressJsonRoute(
      route((request, response) =>
        response
          .status(201)
          .json({ import: service.preview(identity(request), request.body) }),
      ),
    ),
  );
  app.get(
    "/api/imports/:id",
    route((request, response) =>
      response.json({
        import: service.get(identity(request), String(request.params.id)),
      }),
    ),
  );
  app.post(
    "/api/imports/:id/commit",
    route((request, response) =>
      response.json({
        import: service.commit(identity(request), String(request.params.id)),
      }),
    ),
  );
  app.get(
    "/api/exports/:resource.csv",
    route((request, response) => {
      const resource = String(request.params.resource) as
        "companies" | "contacts";
      const csv = service.export(
        identity(request),
        resource,
        new URLSearchParams(request.query as Record<string, string>),
      );
      response.setHeader("content-type", "text/csv; charset=utf-8");
      response.setHeader(
        "content-disposition",
        `attachment; filename="northstar-${resource}.csv"`,
      );
      response.send(csv);
    }),
  );
}

function expressJsonRoute<T>(handler: T): T {
  return handler;
}
