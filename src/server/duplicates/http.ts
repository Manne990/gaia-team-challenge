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
  DuplicateConflictError,
  DuplicateMergeService,
  DuplicateNotFoundError,
} from "./service.js";
export function registerDuplicateRoutes(app: Express, db: Database.Database) {
  const auth = new AuthService(db),
    service = new DuplicateMergeService(db, auth);
  const route =
    (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        fn(req, res);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({
            error: "VALIDATION_ERROR",
            message: "Review every required merge field.",
            fields: error.flatten().fieldErrors,
          });
          return;
        }
        if (error instanceof AuthenticationError) {
          res.status(401).json({
            error: "UNAUTHENTICATED",
            message: "Authentication required.",
          });
          return;
        }
        if (error instanceof AuthorizationError) {
          res.status(403).json({ error: "FORBIDDEN", message: error.message });
          return;
        }
        if (error instanceof DuplicateNotFoundError) {
          res.status(404).json({
            error: "NOT_FOUND",
            message: "A merge record was not found.",
          });
          return;
        }
        if (error instanceof DuplicateConflictError) {
          res.status(409).json({ error: "CONFLICT", message: error.message });
          return;
        }
        next(error);
      }
    };
  const identity = (req: Request) => auth.authenticate(sessionToken(req));
  app.get(
    "/api/duplicates",
    route((req, res) =>
      res.json(
        service.candidates(
          identity(req),
          typeof req.query.entityType === "string"
            ? req.query.entityType
            : undefined,
        ),
      ),
    ),
  );
  app.post(
    "/api/merges",
    route((req, res) =>
      res.json({ merge: service.merge(identity(req), req.body) }),
    ),
  );
  app.get(
    "/api/merge-redirects/:entityType/:id",
    route((req, res) =>
      res.json(
        service.resolveInfo(
          identity(req),
          String(req.params.entityType),
          String(req.params.id),
        ),
      ),
    ),
  );
}
