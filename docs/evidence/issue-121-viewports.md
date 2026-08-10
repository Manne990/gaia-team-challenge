# Issue #121 viewport evidence

Captured from the live root development command on 2026-08-10 after a production build. Browser tests independently assert that `document.documentElement.scrollWidth <= window.innerWidth` at every viewport.

| Viewport | Evidence                                  | Observed layout                                                                                                                   |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1440×900 | [Desktop capture](issue-121-1440x900.png) | Full persistent navigation, four metrics, dense deal table, and task/state side rail.                                             |
| 1024×768 | [Tablet capture](issue-121-1024x768.png)  | Compact persistent navigation, four metrics, full-width operational table, secondary content below.                               |
| 390×844  | [Mobile capture](issue-121-390x844.png)   | Sticky mobile header and drawer trigger, two-column metrics, wrapped filters, and locally scrollable table without page overflow. |

The `npm run test:browser` Playwright suite also verifies owner navigation coverage, mobile drawer focus/close behavior, and native confirmation-dialog focus behavior. Captures contain deterministic foundation data only and no secrets or user-provided records.
