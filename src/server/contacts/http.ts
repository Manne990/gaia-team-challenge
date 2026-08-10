import type Database from "better-sqlite3";
import type { Express, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
} from "../auth/service.js";
import { sessionToken } from "../auth/http.js";
import {
  ContactConflictError,
  ContactNotFoundError,
  ContactsService,
} from "./service.js";

export function registerContactRoutes(
  app: Express,
  database: Database.Database,
) {
  const auth = new AuthService(database);
  const contacts = new ContactsService(database, auth);

  function route(operation: (request: Request, response: Response) => void) {
    return (request: Request, response: Response, next: NextFunction) => {
      try {
        operation(request, response);
      } catch (error) {
        if (error instanceof ZodError) {
          response.status(400).json({
            error: "VALIDATION_ERROR",
            message: "Correct the highlighted contact fields.",
            fields: error.flatten().fieldErrors,
          });
          return;
        }
        if (error instanceof AuthenticationError) {
          response.status(401).json({
            error: "UNAUTHENTICATED",
            message: "Authentication required.",
          });
          return;
        }
        if (
          error instanceof ContactNotFoundError ||
          (error instanceof AuthorizationError &&
            error.message.includes("not found"))
        ) {
          response.status(404).json({
            error: "NOT_FOUND",
            message: "The requested contact was not found.",
          });
          return;
        }
        if (error instanceof AuthorizationError) {
          response
            .status(403)
            .json({ error: "FORBIDDEN", message: error.message });
          return;
        }
        if (error instanceof ContactConflictError) {
          response
            .status(409)
            .json({ error: "CONFLICT", message: error.message });
          return;
        }
        next(error);
      }
    };
  }

  const identity = (request: Request) =>
    auth.authenticate(sessionToken(request));
  const parameter = (request: Request, name: string) => {
    const value = request.params[name];
    return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  };

  app.get(
    "/api/contacts",
    route((request, response) => {
      const query = Object.fromEntries(
        Object.entries(request.query).map(([key, value]) => [
          key,
          typeof value === "string" ? value : undefined,
        ]),
      );
      response.json(contacts.list(identity(request), query));
    }),
  );
  app.post(
    "/api/contacts",
    route((request, response) => {
      response
        .status(201)
        .json({ contact: contacts.create(identity(request), request.body) });
    }),
  );
  app.get(
    "/api/contacts/:id",
    route((request, response) => {
      response.json({
        contact: contacts.get(identity(request), parameter(request, "id")),
      });
    }),
  );
  app.patch(
    "/api/contacts/:id",
    route((request, response) => {
      response.json({
        contact: contacts.update(
          identity(request),
          parameter(request, "id"),
          request.body,
        ),
      });
    }),
  );
  app.post(
    "/api/contacts/:id/archive",
    route((request, response) => {
      response.json({
        contact: contacts.setArchived(
          identity(request),
          parameter(request, "id"),
          true,
        ),
      });
    }),
  );
  app.post(
    "/api/contacts/:id/restore",
    route((request, response) => {
      response.json({
        contact: contacts.setArchived(
          identity(request),
          parameter(request, "id"),
          false,
        ),
      });
    }),
  );
}
