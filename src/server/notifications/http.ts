import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthService,
  AuthenticationError,
  sessionToken,
} from "../auth/index.js";
import {
  NotificationNotFoundError,
  NotificationService,
  NotificationValidationError,
  type NotificationFilter,
} from "./service.js";

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

export function createNotificationHttpHandler(
  auth: AuthService,
  notifications: NotificationService,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const url = new URL(request.url ?? "/", "http://local");
    if (!url.pathname.startsWith("/api/notifications")) return false;
    try {
      const identity = auth.authenticate(sessionToken(request));
      if (request.method === "GET" && url.pathname === "/api/notifications") {
        const filter = url.searchParams.get("filter") ?? "all";
        if (filter !== "all" && filter !== "unread")
          throw new NotificationValidationError(
            "Choose a valid notification filter.",
          );
        json(
          response,
          200,
          notifications.list(identity, filter as NotificationFilter),
        );
        return true;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/notifications/generate"
      ) {
        json(response, 200, notifications.generate(identity));
        return true;
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/notifications/read-all"
      ) {
        json(response, 200, notifications.markAllRead(identity));
        return true;
      }
      const match = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (request.method === "POST" && match) {
        json(
          response,
          200,
          notifications.markRead(identity, decodeURIComponent(match[1])),
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
      else if (error instanceof NotificationNotFoundError)
        json(response, 404, { code: "NOT_FOUND", error: error.message });
      else if (error instanceof NotificationValidationError)
        json(response, 400, { code: "VALIDATION_ERROR", error: error.message });
      else throw error;
      return true;
    }
  };
}
