import { useEffect, useRef, useState } from "react";

type SearchItem = { id: string; title: string; context: string; href: string };
type SearchGroup = {
  resource: "companies" | "contacts" | "deals" | "tasks";
  label: string;
  items: SearchItem[];
};
type SearchResponse = { query: string; groups: SearchGroup[] };

async function search(text: string, signal: AbortSignal) {
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(text)}&limit=5`,
    { signal },
  );
  const body = (await response.json().catch(() => ({}))) as SearchResponse & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(body.error ?? "Search could not be completed.");
  return body;
}

export function GlobalSearch() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = text.trim();
  useEffect(() => {
    if (trimmed.length < 2) {
      // Reset transient results when the external search synchronization stops.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null);
      setStatus("idle");
      setActive(-1);
      return;
    }
    const controller = new AbortController();
    setDismissed(false);
    setStatus("loading");
    setMessage("");
    void search(trimmed, controller.signal)
      .then((data) => {
        setResult(data);
        setStatus("idle");
        setActive(-1);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setResult(null);
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Search could not be completed.",
        );
      });
    return () => controller.abort();
  }, [trimmed]);

  const items = result?.groups.flatMap((group) => group.items) ?? [];
  const open = trimmed.length >= 2 && !dismissed;
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setDismissed(true);
      setActive(-1);
    } else if (event.key === "ArrowDown" && items.length) {
      event.preventDefault();
      setActive((current) => (current + 1) % items.length);
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      setActive((current) => (current <= 0 ? items.length - 1 : current - 1));
    } else if (event.key === "Enter" && active >= 0 && items[active]) {
      window.location.assign(items[active].href);
    }
  }

  return (
    <div className="global-search">
      <label htmlFor="global-search-input">Search your workspace</label>
      <input
        ref={inputRef}
        id="global-search-input"
        type="search"
        role="combobox"
        value={text}
        placeholder="Search companies, contacts, deals, or tasks"
        autoComplete="off"
        aria-controls="global-search-results"
        aria-expanded={open}
        aria-activedescendant={
          active >= 0 ? `search-result-${active}` : undefined
        }
        onChange={(event) => {
          setText(event.target.value);
          setDismissed(false);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div
          id="global-search-results"
          className="search-results"
          role="status"
          aria-live="polite"
        >
          {status === "loading" && <p className="search-state">Searching…</p>}
          {status === "error" && (
            <p className="search-state search-error" role="alert">
              {message}
            </p>
          )}
          {status === "idle" && result && items.length === 0 && (
            <p className="search-state">No matches found.</p>
          )}
          {status === "idle" && result && items.length > 0 && (
            <div role="listbox" aria-label="Search results">
              {result.groups.map((group) => (
                <section
                  key={group.resource}
                  className="search-group"
                  aria-labelledby={`search-group-${group.resource}`}
                >
                  <h2 id={`search-group-${group.resource}`}>{group.label}</h2>
                  <ul>
                    {group.items.map((item) => {
                      const index = items.indexOf(item);
                      return (
                        <li key={`${group.resource}-${item.id}`}>
                          <a
                            id={`search-result-${index}`}
                            href={item.href}
                            role="option"
                            aria-selected={index === active}
                            aria-label={`${item.title} ${item.context}`}
                            className={
                              index === active
                                ? "search-result-active"
                                : undefined
                            }
                            onMouseEnter={() => setActive(index)}
                            onClick={() => setDismissed(true)}
                          >
                            <strong>{item.title}</strong>
                            <span>{item.context}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="search-hint" aria-live="polite">
        {trimmed.length < 2
          ? "Type at least 2 characters"
          : "Use arrow keys to navigate; Escape to dismiss"}
      </span>
    </div>
  );
}
