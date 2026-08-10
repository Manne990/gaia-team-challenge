import type Database from "better-sqlite3";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
  sessionToken,
} from "../auth/index.js";
import {
  DealConflictError,
  DealNotFoundError,
  DealsService,
  DealValidationError,
} from "./service.js";

export function registerDealRoutes(app: Express, db: Database.Database) {
  const auth = new AuthService(db),
    deals = new DealsService(db);
  const route =
    (
      minimum: "viewer" | "member" | "owner",
      handler: (
        request: Request,
        response: Response,
        identity: ReturnType<AuthService["authenticate"]>,
      ) => unknown,
    ) =>
    (request: Request, response: Response) => {
      try {
        const identity = auth.authenticate(sessionToken(request));
        auth.requireRole(identity, minimum);
        const value = handler(request, response, identity);
        if (!response.headersSent) response.json(value);
      } catch (error) {
        respond(response, error);
      }
    };
  app.get(
    "/api/deals",
    route("viewer", (request, _response, identity) =>
      deals.list(
        identity,
        new URLSearchParams(request.query as Record<string, string>),
      ),
    ),
  );
  app.post(
    "/api/deals",
    route("member", (request, response, identity) => {
      response.status(201);
      return deals.create(identity, request.body);
    }),
  );
  app.get(
    "/api/deals/:id",
    route("viewer", (request, _response, identity) =>
      deals.get(identity, param(request)),
    ),
  );
  app.put(
    "/api/deals/:id",
    route("member", (request, _response, identity) =>
      deals.update(identity, param(request), request.body),
    ),
  );
  app.post(
    "/api/deals/:id/transition",
    route("member", (request, _response, identity) =>
      deals.transition(identity, param(request), request.body),
    ),
  );
  app.post(
    "/api/deals/:id/archive",
    route("member", (request, _response, identity) =>
      deals.setArchived(identity, param(request), true),
    ),
  );
  app.post(
    "/api/deals/:id/restore",
    route("member", (request, _response, identity) =>
      deals.setArchived(identity, param(request), false),
    ),
  );
  app.get(
    "/api/pipeline/stages",
    route("viewer", (request, _response, identity) => ({
      stages: deals.stages(identity, request.query.includeInactive === "true"),
    })),
  );
  app.post(
    "/api/pipeline/stages",
    route("owner", (request, response, identity) => {
      response.status(201);
      return { stage: deals.createStage(identity, request.body) };
    }),
  );
  app.put(
    "/api/pipeline/stages/:id",
    route("owner", (request, _response, identity) => ({
      stage: deals.updateStage(identity, param(request), request.body),
    })),
  );
  app.post(
    "/api/pipeline/stages/:id/deactivate",
    route("owner", (request, _response, identity) => ({
      stage: deals.deactivateStage(identity, param(request)),
    })),
  );
}

function param(request: Request) {
  const value = request.params.id;
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
function respond(response: Response, error: unknown) {
  if (error instanceof AuthenticationError)
    response
      .status(401)
      .json({ code: "UNAUTHENTICATED", error: "Authentication required." });
  else if (error instanceof AuthorizationError)
    response.status(403).json({ code: "FORBIDDEN", error: error.message });
  else if (error instanceof DealNotFoundError)
    response.status(404).json({ code: "NOT_FOUND", error: "Deal not found." });
  else if (error instanceof DealConflictError)
    response
      .status(409)
      .json({ code: "VERSION_CONFLICT", error: error.message });
  else if (error instanceof DealValidationError)
    response.status(400).json({
      code: "VALIDATION_ERROR",
      error: error.message,
      issues: error.issues,
    });
  else if (error instanceof z.ZodError)
    response.status(400).json({
      code: "VALIDATION_ERROR",
      error: "Correct the highlighted fields.",
    });
  else throw error;
}
