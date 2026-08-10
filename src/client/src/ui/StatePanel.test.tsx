import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatePanel, type StateKind } from "./StatePanel";

describe("StatePanel", () => {
  it.each([
    "loading",
    "empty",
    "error",
    "forbidden",
    "not-found",
    "conflict",
  ] satisfies StateKind[])("renders a deliberate %s state", (kind) => {
    const { container } = render(
      <StatePanel
        kind={kind}
        title={`${kind} title`}
        detail="Corrective detail"
      />,
    );
    const view = within(container);
    expect(
      view.getByRole("heading", { name: `${kind} title` }),
    ).toBeInTheDocument();
    expect(view.getByText("Corrective detail")).toBeInTheDocument();
  });
});
