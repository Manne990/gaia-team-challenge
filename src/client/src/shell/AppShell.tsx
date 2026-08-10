import { type ReactNode, useEffect, useRef, useState } from "react";
import { navigationForRole, type UserRole } from "./navigation";
import { routeFromHash } from "../search/urlState";
import { GlobalSearch } from "../search/GlobalSearch";
import "../search/search.css";

export interface ShellUser {
  name: string;
  organization: string;
  role: UserRole;
}

export function AppShell({
  productName,
  user,
  accountAction,
  children,
}: {
  productName: string;
  user: ShellUser;
  accountAction?: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeHref, setActiveHref] = useState(() => `#${routeFromHash()}`);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const items = navigationForRole(user.role);
  const initials = user.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (menuOpen) firstLink.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    const syncHash = () => setActiveHref(`#${routeFromHash()}`);
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="mobile-header">
        <button
          ref={menuButton}
          className="icon-button"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen(true)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <strong>{productName}</strong>
        <span className="avatar" aria-label={`Signed in as ${user.name}`}>
          {initials}
        </span>
      </header>
      {menuOpen && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={closeMenu}
        />
      )}
      <aside
        id="primary-navigation"
        className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}
        aria-label="Primary"
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>
          <span className="brand-name">{productName}</span>
          <button
            className="icon-button nav-close"
            aria-label="Close navigation"
            onClick={closeMenu}
          >
            ×
          </button>
        </div>
        <nav>
          <ul className="nav-list">
            {items.map((item, index) => (
              <li key={item.href}>
                <a
                  ref={index === 0 ? firstLink : undefined}
                  href={item.href}
                  className={
                    activeHref === item.href ||
                    activeHref.startsWith(`${item.href}/`)
                      ? "active"
                      : undefined
                  }
                  aria-current={
                    activeHref === item.href ||
                    activeHref.startsWith(`${item.href}/`)
                      ? "page"
                      : undefined
                  }
                  onClick={() => {
                    setActiveHref(item.href);
                    setMenuOpen(false);
                  }}
                >
                  <span className="nav-icon" aria-hidden="true">
                    {item.short}
                  </span>
                  <span>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="profile">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="profile-copy">
            <strong>{user.name}</strong>
            <small>
              {user.organization} · {user.role}
            </small>
          </span>
          {accountAction ?? (
            <button className="icon-button" aria-label="Open account menu">
              ⋯
            </button>
          )}
        </div>
      </aside>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <GlobalSearch />
        {children}
      </main>
    </div>
  );
}
