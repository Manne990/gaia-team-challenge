import { expect as baseExpect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      // Chromium reports expected, explicitly asserted 4xx responses as
      // resource-console errors. Application console.error calls remain fatal.
      if (
        message.type() === "error" &&
        !text.startsWith(
          "Failed to load resource: the server responded with a status of",
        )
      )
        consoleErrors.push(text);
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "failed";
      // Route changes intentionally abort in-flight reads through AbortController.
      if (reason !== "net::ERR_ABORTED")
        requestFailures.push(`${request.method()} ${request.url()}: ${reason}`);
    });

    await use(page);

    baseExpect(
      consoleErrors,
      `console errors: ${consoleErrors.join(" | ")}`,
    ).toEqual([]);
    baseExpect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual(
      [],
    );
    baseExpect(
      requestFailures,
      `request failures: ${requestFailures.join(" | ")}`,
    ).toEqual([]);
  },
});

export { baseExpect as expect };
