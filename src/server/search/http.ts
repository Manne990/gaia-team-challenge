import type Database from "better-sqlite3";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  AuthService,
  AuthenticationError,
  sessionToken,
} from "../auth/index.js";
import {
  SavedViewConflictError,
  SavedViewNotFoundError,
  SearchService,
  SearchValidationError,
} from "./service.js";

export function registerSearchRoutes(app: Express, db: Database.Database) {
  const auth = new AuthService(db),
    service = new SearchService(db);
  const route =
    (operation: (request: Request, response: Response) => void) =>
    (request: Request, response: Response, next: NextFunction) => {
      try {
        operation(request, response);
      } catch (error) {
        if (error instanceof AuthenticationError)
          response.status(401).json({
            code: "UNAUTHENTICATED",
            error: "Authentication required.",
          });
        else if (error instanceof SearchValidationError)
          response.status(400).json({
            code: "VALIDATION_ERROR",
            error: error.message,
            issues: error.issues,
          });
        else if (error instanceof SavedViewNotFoundError)
          response
            .status(404)
            .json({ code: "NOT_FOUND", error: "Saved view not found." });
        else if (error instanceof SavedViewConflictError)
          response.status(409).json({ code: "CONFLICT", error: error.message });
        else next(error);
      }
    };
  const identity = (request: Request) =>
    auth.authenticate(sessionToken(request));
  app.get(
    "/api/search",
    route((request, response) =>
      response.json(
        service.search(
          identity(request),
          text(request.query.q),
          text(request.query.limit),
        ),
      ),
    ),
  );
  app.get(
    "/api/saved-views",
    route((request, response) =>
      response.json(
        service.listViews(identity(request), text(request.query.resource)),
      ),
    ),
  );
  app.post(
    "/api/saved-views",
    route((request, response) =>
      response
        .status(201)
        .json({ view: service.createView(identity(request), request.body) }),
    ),
  );
  app.put(
    "/api/saved-views/:id",
    route((request, response) =>
      response.json({
        view: service.updateView(
          identity(request),
          param(request),
          request.body,
        ),
      }),
    ),
  );
  app.delete(
    "/api/saved-views/:id",
    route((request, response) => {
      const version = z
        .number()
        .int()
        .positive()
        .safeParse(request.body?.version);
      if (!version.success)
        throw new SearchValidationError(["Saved view version is required."]);
      service.deleteView(identity(request), param(request), version.data);
      response.status(204).end();
    }),
  );
}
const text = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const param = (request: Request) => {
  const value = request.params.id;
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
