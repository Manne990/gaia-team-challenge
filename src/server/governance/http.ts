import type Database from "better-sqlite3";
import type { Express, Response } from "express";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
  sessionToken,
} from "../auth/index.js";
import { AuditService, AuditValidationError } from "./audit-service.js";

export function registerGovernanceRoutes(app: Express, db: Database.Database) {
  const auth = new AuthService(db);
  const audit = new AuditService(db);
  app.get("/api/audit", (request, response) => {
    try {
      const identity = auth.authenticate(sessionToken(request));
      response.json(
        audit.list(
          identity,
          new URLSearchParams(request.query as Record<string, string>),
        ),
      );
    } catch (error) {
      respond(response, error);
    }
  });
}

function respond(response: Response, error: unknown) {
  if (error instanceof AuthenticationError)
    response
      .status(401)
      .json({ code: "UNAUTHENTICATED", error: "Authentication required." });
  else if (error instanceof AuthorizationError)
    response.status(403).json({ code: "FORBIDDEN", error: error.message });
  else if (error instanceof AuditValidationError)
    response
      .status(400)
      .json({ code: "VALIDATION_ERROR", error: error.message });
  else throw error;
}
