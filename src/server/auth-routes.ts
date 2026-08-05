import { AuthService, AuthenticationError } from "./auth.js";

const cookieName = "northstar_session";

export function sessionTokenFromCookie(cookie: string | null): string | undefined {
  return cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export async function handleAuthRequest(request: Request, auth: AuthService): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/sign-in" && request.method === "POST") {
    let payload: { email?: unknown; password?: unknown };
    try { payload = await request.json() as { email?: unknown; password?: unknown }; } catch { return json({ error: "Enter your email and password." }, 400); }
    if (typeof payload.email !== "string" || typeof payload.password !== "string") return json({ error: "Enter your email and password." }, 400);
    try {
      const { token, session } = await auth.signIn(payload.email, payload.password);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))) });
    } catch (error) {
      if (error instanceof AuthenticationError) return json({ error: error.message }, 401);
      throw error;
    }
  }
  if (url.pathname === "/api/auth/sign-out" && request.method === "POST") {
    await auth.signOut(sessionTokenFromCookie(request.headers.get("cookie")));
    return json({ ok: true }, 200, { "set-cookie": `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  }
  return null;
}

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
