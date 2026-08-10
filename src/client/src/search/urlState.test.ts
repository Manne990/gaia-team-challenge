import { afterEach, describe, expect, it } from "vitest";
import { readListState, routeFromHash, writeListState } from "./urlState";

afterEach(() => window.history.replaceState(null, "", "#dashboard"));

describe("list URL state", () => {
  it("round-trips meaningful filters and ignores another resource", () => {
    writeListState("companies", {
      q: "Northstar",
      lifecycle: "customer",
      page: "1",
      archived: "",
    });
    expect(window.location.hash).toBe(
      "#companies?q=Northstar&lifecycle=customer",
    );
    expect(routeFromHash()).toBe("companies");
    expect(readListState("companies")).toEqual({
      q: "Northstar",
      lifecycle: "customer",
    });
    expect(readListState("contacts")).toEqual({});
  });
});
