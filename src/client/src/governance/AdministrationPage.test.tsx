import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdministrationPage } from "./AdministrationPage";

const data = {
  organization: {
    id: "org-1",
    name: "Northstar",
    slug: "northstar",
    version: 3,
    updatedAt: "2026-08-10T00:00:00Z",
  },
  members: [
    {
      membershipId: "m-1",
      userId: "u-1",
      email: "a@example.com",
      displayName: "Ada",
      role: "member" as const,
    },
  ],
};
const createdMember = {
  membershipId: "m-2",
  userId: "u-2",
  email: "new@example.com",
  displayName: "New User",
  role: "member" as const,
};
const ok = (body: unknown) => ({ ok: true, json: async () => body });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("AdministrationPage", () => {
  it("loads organization and member data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(data));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrationPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(
      await screen.findByRole("heading", {
        name: "Organization administration",
      }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Northstar")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });
  it("updates the name and creates a member", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(data))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok(data))
      .mockResolvedValueOnce(ok({ member: createdMember }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdministrationPage />);
    await screen.findByDisplayValue("Northstar");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/organization",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "New name", version: 3 }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add member" })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "New User" },
    });
    fireEvent.change(screen.getByLabelText("Temporary password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/members",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("New User")).toBeInTheDocument();
  });
  it("confirms revoke and shows retry after an error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Denied" }),
      })
      .mockResolvedValue(ok(data));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(<AdministrationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Denied");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Ada");
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/members/u-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
