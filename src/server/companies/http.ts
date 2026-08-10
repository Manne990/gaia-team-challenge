import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
  sessionToken,
} from "../auth/index.js";
import {
  CompanyConflictError,
  CompanyNotFoundError,
  CompanyService,
  CompanyValidationError,
  CompanyVersionConflictError,
} from "./service.js";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024)
      throw new CompanyValidationError(["Company request is too large."]);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CompanyValidationError(["Provide valid JSON."]);
  }
}

export function createCompanyHttpHandler(
  auth: AuthService,
  companies: CompanyService,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://local");
    if (!url.pathname.startsWith("/api/companies")) return false;
    try {
      const identity = auth.authenticate(sessionToken(request));
      const match = url.pathname.match(
        /^\/api\/companies\/([^/]+)(?:\/(archive|restore))?$/,
      );
      if (request.method === "GET" && url.pathname === "/api/companies") {
        json(response, 200, companies.list(identity, url.searchParams));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/companies") {
        auth.requireRole(identity, "member");
        json(
          response,
          201,
          await companies.create(identity, await readJson(request)),
        );
        return true;
      }
      if (match && request.method === "GET" && !match[2]) {
        json(
          response,
          200,
          companies.get(identity, decodeURIComponent(match[1])),
        );
        return true;
      }
      if (match && request.method === "PUT" && !match[2]) {
        auth.requireRole(identity, "member");
        json(
          response,
          200,
          companies.update(
            identity,
            decodeURIComponent(match[1]),
            await readJson(request),
          ),
        );
        return true;
      }
      if (
        match &&
        request.method === "POST" &&
        (match[2] === "archive" || match[2] === "restore")
      ) {
        auth.requireRole(identity, "member");
        json(
          response,
          200,
          companies.setArchived(
            identity,
            decodeURIComponent(match[1]),
            match[2] === "archive",
          ),
        );
        return true;
      }
      return false;
    } catch (error) {
      if (error instanceof AuthenticationError)
        json(response, 401, {
          code: "UNAUTHENTICATED",
          error: "Authentication required.",
        });
      else if (error instanceof AuthorizationError)
        json(response, 403, { code: "FORBIDDEN", error: error.message });
      else if (error instanceof CompanyNotFoundError)
        json(response, 404, { code: "NOT_FOUND", error: "Company not found." });
      else if (error instanceof CompanyValidationError)
        json(response, 400, {
          code: "VALIDATION_ERROR",
          error: error.message,
          issues: error.issues,
        });
      else if (error instanceof CompanyVersionConflictError)
        json(response, 409, { code: "VERSION_CONFLICT", error: error.message });
      else if (error instanceof CompanyConflictError)
        json(response, 409, { code: "CONFLICT", error: error.message });
      else throw error;
      return true;
    }
  };
}
