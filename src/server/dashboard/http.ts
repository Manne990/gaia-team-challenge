import type Database from "better-sqlite3";
import type { Express, NextFunction, Request, Response } from "express";
import {
  AuthService,
  AuthenticationError,
  sessionToken,
} from "../auth/index.js";
import { DashboardService } from "./service.js";

export function registerDashboardRoutes(app: Express, db: Database.Database) {
  const auth = new AuthService(db);
  const dashboard = new DashboardService(db);
  app.get(
    "/api/dashboard",
    (request: Request, response: Response, next: NextFunction) => {
      try {
        const identity = auth.authenticate(sessionToken(request));
        response.setHeader("cache-control", "no-store");
        response.json(dashboard.get(identity));
      } catch (error) {
        if (error instanceof AuthenticationError) {
          response.status(401).json({
            code: "UNAUTHENTICATED",
            error: "Authentication required.",
          });
          return;
        }
        next(error);
      }
    },
  );
}
