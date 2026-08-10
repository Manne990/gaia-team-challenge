import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompaniesPage } from "./CompaniesPage";

const company = {
  id: "company_1",
  name: "Acme AB",
  externalReference: "AC-1",
  website: null,
  phone: null,
  industry: "Technology",
  size: "11-50",
  address: null,
  lifecycleStatus: "customer",
  ownerMembershipId: "member_1",
  ownerName: "Owner",
  tags: ["priority"],
  description: "Important account",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  archivedAt: null,
  version: 3,
};
const detail = {
  company,
  contacts: [
    {
      id: "contact_1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      status: "active",
    },
  ],
  activities: [
    {
      id: "activity_1",
      type: "note",
      subject: "Intro",
      body: "Met",
      occurredAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  deals: [
    {
      id: "deal_1",
      name: "Renewal",
      amountMinor: 1000,
      currency: "USD",
      status: "open",
      stage: "Proposal",
    },
  ],
  tasks: [
    {
      id: "task_1",
      title: "Follow up",
      dueAt: "2026-01-03",
      priority: "high",
      status: "open",
    },
  ],
  history: [
    {
      id: "audit_1",
      action: "company.created",
      summary: { name: "Acme AB" },
      occurredAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.sequential("CompaniesPage", () => {
  it("moves from a filtered list to a durable detail view", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("company_1")
          ? { ok: true, json: async () => detail }
          : {
              ok: true,
              json: async () => ({
                items: [company],
                page: 1,
                pageSize: 10,
                total: 1,
              }),
            },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<CompaniesPage role="member" />);
    expect(
      await screen.findByRole("button", { name: "Acme AB" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acme AB" }));
    expect(
      await screen.findByRole("heading", { name: "Company information" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Renewal")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toContain("page=1");
  });

  it("keeps viewers read-only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("company_1")
            ? { ok: true, json: async () => detail }
            : {
                ok: true,
                json: async () => ({
                  items: [company],
                  page: 1,
                  pageSize: 10,
                  total: 1,
                }),
              },
        ),
      ),
    );
    render(<CompaniesPage role="viewer" />);
    expect(
      await screen.findByRole("button", { name: "Acme AB" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create company" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Acme AB" }));
    expect(
      await screen.findByRole("heading", { name: "Company information" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });

  it("shows validation issues and version conflicts from save", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [company],
          page: 1,
          pageSize: 10,
          total: 1,
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => detail })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          code: "VERSION_CONFLICT",
          error: "This company changed",
          issues: ["Refresh before saving."],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<CompaniesPage role="member" />);
    fireEvent.click(await screen.findByRole("button", { name: "Acme AB" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Changed Acme" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save company" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This company has changed",
      ),
    );
    expect(screen.getByText("Refresh before saving.")).toBeInTheDocument();
  });
});
