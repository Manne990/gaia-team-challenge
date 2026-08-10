import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("honors explicit command line values", () => {
    const config = loadConfig(
      [
        "--host",
        "0.0.0.0",
        "--port",
        "5050",
        "--database-path",
        "./tmp/test.sqlite",
      ],
      { NODE_ENV: "test" },
    );
    expect(config).toMatchObject({
      host: "0.0.0.0",
      port: 5050,
      environment: "test",
    });
    expect(config.databasePath).toMatch(/tmp\/test\.sqlite$/);
  });
  it("rejects invalid ports with a clear configuration error", () => {
    expect(() => loadConfig(["--port", "70000"], { NODE_ENV: "test" })).toThrow(
      /Configuration error/,
    );
  });
  it("rejects missing argument values", () => {
    expect(() => loadConfig(["--database-path"], { NODE_ENV: "test" })).toThrow(
      "--database-path requires a value",
    );
  });
});
