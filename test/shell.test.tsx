import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/app";

describe("CRM application shell", () => {
  it("renders operational navigation and changes to the companies workspace", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("heading", { name: "Good morning, Lina" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Companies" }));
    expect(screen.getByRole("heading", { name: "Companies" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search companies" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Companies list" })).toBeInTheDocument();
  });

  it("renders deliberate loading, error, not-found, conflict, and forbidden states", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Activities" }));
    expect(screen.getByRole("heading", { name: "Loading activity" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Deals" }));
    expect(screen.getByRole("heading", { name: "Couldn’t load deals" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(screen.getByRole("heading", { name: "This task changed elsewhere" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Audit" }));
    expect(screen.getByRole("heading", { name: "No audit event found" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Preview role" }), "viewer");
    expect(screen.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
  });
});
