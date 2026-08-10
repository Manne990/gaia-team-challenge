import { parse, serialize } from "cookie";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AuthService,
  AuthenticationError,
  AuthorizationError,
  MembershipConflictError,
  SessionExpiredError,
  type Role,
} from "./service.js";

const COOKIE = "northstar_session";

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
    if (size > 16_384) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function sessionToken(request: IncomingMessage): string | undefined {
  return parse(request.headers.cookie ?? "")[COOKIE];
}

export function createAuthHttpHandler(auth: AuthService) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<boolean> => {
    const path = new URL(request.url ?? "/", "http://local").pathname;
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (request.method !== "GET" && origin && host) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === host;
      } catch {
        /* malformed origins are denied */
      }
      if (!sameOrigin) {
        json(response, 403, { error: "Request origin is not allowed." });
        return true;
      }
    }
    if (request.method === "POST" && path === "/api/auth/sign-in") {
      try {
        const body = (await readJson(request)) as Record<string, unknown>;
        if (typeof body.email !== "string" || typeof body.password !== "string")
          throw new AuthenticationError("Invalid sign-in request.");
        const result = await auth.signIn(
          body.email,
          body.password,
          typeof body.organizationId === "string"
            ? body.organizationId
            : undefined,
        );
        response.setHeader(
          "set-cookie",
          serialize(COOKIE, result.token, {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: 8 * 60 * 60,
          }),
        );
        json(response, 200, {
          user: {
            id: result.identity.userId,
            email: result.identity.email,
            displayName: result.identity.displayName,
            role: result.identity.role,
            organizationName: result.identity.organizationName,
          },
        });
      } catch (error) {
        if (error instanceof AuthenticationError) {
          json(response, 401, { error: error.message });
        } else if (
          error instanceof SyntaxError ||
          (error instanceof Error && error.message === "Request is too large.")
        ) {
          json(response, 400, { error: "Unable to sign in." });
        } else {
          throw error;
        }
      }
      return true;
    }
    if (request.method === "POST" && path === "/api/auth/logout") {
      auth.logout(sessionToken(request));
      response.setHeader(
        "set-cookie",
        serialize(COOKIE, "", {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 0,
        }),
      );
      json(response, 204, undefined);
      return true;
    }
    if (request.method === "GET" && path === "/api/auth/session") {
      try {
        const identity = auth.authenticate(sessionToken(request));
        json(response, 200, {
          user: {
            id: identity.userId,
            email: identity.email,
            displayName: identity.displayName,
            role: identity.role,
            organizationName: identity.organizationName,
          },
        });
      } catch (error) {
        if (!(error instanceof AuthenticationError)) throw error;
        json(
          response,
          401,
          error instanceof SessionExpiredError
            ? { code: "SESSION_EXPIRED", error: error.message }
            : { code: "UNAUTHENTICATED", error: "Authentication required." },
        );
      }
      return true;
    }
    const memberMatch = path.match(/^\/api\/admin\/members(?:\/([^/]+))?$/);
    if (memberMatch) {
      try {
        const identity = auth.authenticate(sessionToken(request));
        if (request.method === "GET" && !memberMatch[1]) {
          json(response, 200, { members: auth.listMemberships(identity) });
          return true;
        }
        if (request.method === "POST" && !memberMatch[1]) {
          const value = (await readJson(request)) as Record<string, unknown>;
          if (
            typeof value.email !== "string" ||
            typeof value.displayName !== "string" ||
            typeof value.password !== "string" ||
            !(["owner", "member", "viewer"] as unknown[]).includes(value.role)
          ) {
            json(response, 400, {
              error: "Complete the member account fields.",
            });
            return true;
          }
          const member = await auth.createMember(identity, {
            email: value.email,
            displayName: value.displayName,
            password: value.password,
            role: value.role as Role,
          });
          json(response, 201, { member });
          return true;
        }
        const userId = memberMatch[1] && decodeURIComponent(memberMatch[1]);
        if (request.method === "PATCH" && userId) {
          const body = (await readJson(request)) as { role?: unknown };
          if (
            !(["owner", "member", "viewer"] as unknown[]).includes(body.role)
          ) {
            json(response, 400, { error: "Choose a valid role." });
            return true;
          }
          auth.updateMembership(identity, userId, body.role as Role);
          json(response, 200, { ok: true });
          return true;
        }
        if (request.method === "DELETE" && userId) {
          auth.removeMembership(identity, userId);
          json(response, 200, { ok: true });
          return true;
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          json(response, 400, { error: "Invalid JSON request." });
          return true;
        }
        if (
          !(error instanceof AuthenticationError) &&
          !(error instanceof AuthorizationError) &&
          !(error instanceof MembershipConflictError)
        )
          throw error;
        const status =
          error instanceof AuthenticationError
            ? 401
            : error instanceof MembershipConflictError
              ? 409
              : error instanceof AuthorizationError &&
                  error.message.includes("not found")
                ? 404
                : 403;
        json(response, status, {
          error: error.message,
        });
        return true;
      }
    }
    if (path === "/api/admin/organization") {
      try {
        const identity = auth.authenticate(sessionToken(request));
        if (request.method === "GET") {
          json(response, 200, auth.organization(identity));
          return true;
        }
        if (request.method === "PATCH") {
          const value = (await readJson(request)) as Record<string, unknown>;
          if (
            typeof value.name !== "string" ||
            !Number.isInteger(value.version)
          ) {
            json(response, 400, {
              error: "Provide valid organization settings.",
            });
            return true;
          }
          json(response, 200, {
            organization: auth.updateOrganization(identity, {
              name: value.name,
              version: Number(value.version),
            }),
          });
          return true;
        }
        return false;
      } catch (error) {
        if (error instanceof SyntaxError) {
          json(response, 400, { error: "Invalid JSON request." });
          return true;
        }
        if (
          !(error instanceof AuthenticationError) &&
          !(error instanceof AuthorizationError) &&
          !(error instanceof MembershipConflictError)
        )
          throw error;
        json(
          response,
          error instanceof AuthenticationError
            ? 401
            : error instanceof MembershipConflictError
              ? 409
              : 403,
          { error: error.message },
        );
        return true;
      }
    }
    return false;
  };
}
