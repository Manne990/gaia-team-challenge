import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shell includes every required operational destination and keyboard skip link", async () => {
  const app = await readFile(new URL("../src/app.tsx", import.meta.url), "utf8");
  for (const destination of ["Dashboard", "Companies", "Contacts", "Activities", "Deals", "Tasks", "Imports", "Audit", "Administration"]) assert.match(app, new RegExp(`page: \"${destination}\"`));
  assert.match(app, /Skip to content/);
  assert.match(app, /aria-label="Primary navigation"/);
});

test("shell keeps responsive and focus affordances in its design system", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /overflow-x: auto/);
});
