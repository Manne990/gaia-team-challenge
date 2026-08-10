export type UserRole = "owner" | "member" | "viewer";

export interface NavigationItem {
  label: string;
  href: string;
  short: string;
  ownerOnly?: boolean;
}

export const navigation: NavigationItem[] = [
  { label: "Dashboard", href: "#dashboard", short: "DB" },
  { label: "Companies", href: "#companies", short: "CO" },
  { label: "Contacts", href: "#contacts", short: "CT" },
  { label: "Activities", href: "#activities", short: "AC" },
  { label: "Deals", href: "#deals", short: "DE" },
  { label: "Tasks", href: "#tasks", short: "TA" },
  { label: "Notifications", href: "#notifications", short: "NO" },
  { label: "Imports", href: "#imports", short: "IM" },
  { label: "Audit", href: "#audit", short: "AU" },
  {
    label: "Administration",
    href: "#administration",
    short: "AD",
    ownerOnly: true,
  },
];

export function navigationForRole(role: UserRole) {
  return navigation.filter((item) => !item.ownerOnly || role === "owner");
}
