// @vitest-environment node
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function baseUrl() {
  const server = createApp().listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("server error contract", () => {
  it("correlates malformed JSON without logging its body", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const response = await fetch(`${await baseUrl()}/api/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(500);
    const requestId = response.headers.get("x-request-id");
    expect(requestId).toBeTruthy();
    expect(await response.json()).toMatchObject({
      error: { code: "UNEXPECTED_ERROR", requestId },
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('"body"');
    errorSpy.mockRestore();
  });

  it("returns a deliberate JSON 404 for unknown API endpoints", async () => {
    const response = await fetch(`${await baseUrl()}/api/does-not-exist`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch("application/json");
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});
