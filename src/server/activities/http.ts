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
  ActivitiesService,
  ActivityConflictError,
  ActivityNotFoundError,
} from "./service.js";

export function registerActivityRoutes(app: Express, db: Database.Database) {
  const auth = new AuthService(db),
    service = new ActivitiesService(db, auth);
  const route =
    (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response, next: NextFunction) => {
      try {
        fn(req, res);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({
            error: "VALIDATION_ERROR",
            message: "Correct the highlighted activity fields.",
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
        if (
          error instanceof ActivityNotFoundError ||
          (error instanceof AuthorizationError &&
            error.message.includes("not found"))
        ) {
          res.status(404).json({
            error: "NOT_FOUND",
            message: "The requested activity was not found.",
          });
          return;
        }
        if (error instanceof AuthorizationError) {
          res.status(403).json({ error: "FORBIDDEN", message: error.message });
          return;
        }
        if (error instanceof ActivityConflictError) {
          res.status(409).json({ error: "CONFLICT", message: error.message });
          return;
        }
        next(error);
      }
    };
  const identity = (req: Request) => auth.authenticate(sessionToken(req));
  const id = (req: Request) => String(req.params.id ?? "");
  app.get(
    "/api/activities",
    route((req, res) =>
      res.json(
        service.list(
          identity(req),
          Object.fromEntries(
            Object.entries(req.query).map(([k, v]) => [
              k,
              typeof v === "string" ? v : undefined,
            ]),
          ),
        ),
      ),
    ),
  );
  app.post(
    "/api/activities",
    route((req, res) =>
      res
        .status(201)
        .json({ activity: service.create(identity(req), req.body) }),
    ),
  );
  app.get(
    "/api/activities/:id",
    route((req, res) =>
      res.json({ activity: service.get(identity(req), id(req)) }),
    ),
  );
  app.patch(
    "/api/activities/:id",
    route((req, res) =>
      res.json({ activity: service.update(identity(req), id(req), req.body) }),
    ),
  );
}
