import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignInPage } from "../src/client/auth/SignInPage.js";

describe("sign-in interface", () => {
  it("has labeled keyboard controls and an explicit expired-session state", () => {
    const html = renderToStaticMarkup(<SignInPage expired />);
    assert.match(html, /<label for="[^"]+">Email address<\/label>/);
    assert.match(html, /type="email"/);
    assert.match(html, /autoComplete="username"/);
    assert.match(html, /<label for="[^"]+">Password<\/label>/);
    assert.match(html, /type="password"/);
    assert.match(html, /Your session expired/);
    assert.match(html, /type="submit"/);
  });
});
