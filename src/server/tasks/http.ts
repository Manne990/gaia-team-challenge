import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
  sessionToken,
} from "../auth/index.js";
import {
  TaskConflictError,
  TaskNotFoundError,
  TaskService,
  TaskValidationError,
  TaskVersionConflictError,
} from "./service.js";

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024)
      throw new TaskValidationError(["Task request is too large."]);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TaskValidationError(["Provide valid JSON."]);
  }
}

export function createTaskHttpHandler(auth: AuthService, tasks: TaskService) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://local");
    if (!url.pathname.startsWith("/api/tasks")) return false;
    try {
      const identity = auth.authenticate(sessionToken(request));
      const match = url.pathname.match(
        /^\/api\/tasks\/([^/]+)(?:\/(complete|reopen|archive|restore))?$/,
      );
      if (request.method === "GET" && url.pathname === "/api/tasks") {
        json(response, 200, tasks.list(identity, url.searchParams));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/api/tasks") {
        auth.requireRole(identity, "member");
        json(response, 201, tasks.create(identity, await body(request)));
        return true;
      }
      if (match && request.method === "GET" && !match[2]) {
        json(response, 200, tasks.get(identity, decodeURIComponent(match[1])));
        return true;
      }
      if (match && request.method === "PUT" && !match[2]) {
        auth.requireRole(identity, "member");
        json(
          response,
          200,
          tasks.update(
            identity,
            decodeURIComponent(match[1]),
            await body(request),
          ),
        );
        return true;
      }
      if (match && request.method === "POST" && match[2]) {
        auth.requireRole(identity, "member");
        const value = (await body(request)) as { version?: unknown };
        if (!Number.isInteger(value.version) || Number(value.version) < 1)
          throw new TaskValidationError([
            "Task version is required. Refresh and try again.",
          ]);
        const id = decodeURIComponent(match[1]);
        const version = Number(value.version);
        const result =
          match[2] === "complete" || match[2] === "reopen"
            ? tasks.setCompleted(identity, id, match[2] === "complete", version)
            : tasks.setArchived(identity, id, match[2] === "archive", version);
        json(response, 200, result);
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
      else if (error instanceof TaskNotFoundError)
        json(response, 404, { code: "NOT_FOUND", error: "Task not found." });
      else if (error instanceof TaskValidationError)
        json(response, 400, {
          code: "VALIDATION_ERROR",
          error: error.message,
          issues: error.issues,
        });
      else if (error instanceof TaskVersionConflictError)
        json(response, 409, { code: "VERSION_CONFLICT", error: error.message });
      else if (error instanceof TaskConflictError)
        json(response, 409, { code: "CONFLICT", error: error.message });
      else throw error;
      return true;
    }
  };
}
