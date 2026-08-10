import { parse, serialize } from "cookie";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthService, AuthenticationError } from "./service.js";

const COOKIE = "northstar_session";

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function sessionToken(request: IncomingMessage): string | undefined {
  return parse(request.headers.cookie ?? "")[COOKIE];
}

export function createAuthHttpHandler(auth: AuthService) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    if (request.method === "POST" && path === "/api/auth/sign-in") {
      try {
        const body = await readJson(request) as Record<string, unknown>;
        if (typeof body.email !== "string" || typeof body.password !== "string") throw new AuthenticationError("Invalid sign-in request.");
        const result = await auth.signIn(body.email, body.password, typeof body.organizationId === "string" ? body.organizationId : undefined);
        response.setHeader("set-cookie", serialize(COOKIE, result.token, {
          httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 60 * 60,
        }));
        json(response, 200, { user: { id: result.identity.userId, email: result.identity.email, displayName: result.identity.displayName, role: result.identity.role } });
      } catch (error) {
        json(response, error instanceof AuthenticationError ? 401 : 400, { error: error instanceof AuthenticationError ? error.message : "Unable to sign in." });
      }
      return true;
    }
    if (request.method === "POST" && path === "/api/auth/logout") {
      auth.logout(sessionToken(request));
      response.setHeader("set-cookie", serialize(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 }));
      json(response, 204, undefined);
      return true;
    }
    if (request.method === "GET" && path === "/api/auth/session") {
      try {
        const identity = auth.authenticate(sessionToken(request));
        json(response, 200, { user: { id: identity.userId, email: identity.email, displayName: identity.displayName, role: identity.role } });
      } catch {
        json(response, 401, { error: "Authentication required." });
      }
      return true;
    }
    return false;
  };
}
