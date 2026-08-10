import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";
import { navigation } from "./navigation";

describe("AppShell", () => {
  it("exposes every product area to an owner", () => {
    const { container } = render(
      <AppShell
        productName="Northstar CRM"
        user={{ name: "Owner", organization: "Northstar", role: "owner" }}
      >
        <p>Workspace</p>
      </AppShell>,
    );
    const view = within(container);
    for (const item of navigation) {
      expect(view.getByRole("link", { name: item.label })).toBeInTheDocument();
    }
  });

  it.each(["member", "viewer"] as const)(
    "hides administration from a %s",
    (role) => {
      const { container } = render(
        <AppShell
          productName="Northstar CRM"
          user={{ name: "User", organization: "Northstar", role }}
        >
          <p>Workspace</p>
        </AppShell>,
      );
      const view = within(container);
      expect(
        view.queryByRole("link", { name: "Administration" }),
      ).not.toBeInTheDocument();
      expect(view.getByRole("link", { name: "Audit" })).toBeInTheDocument();
    },
  );
});
