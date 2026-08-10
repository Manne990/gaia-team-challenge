export function readListState(resource: string): Record<string, string> {
  const [route, query = ""] = window.location.hash.slice(1).split("?");
  if (route !== resource) return {};
  return Object.fromEntries(new URLSearchParams(query));
}

export function writeListState(
  resource: string,
  state: Record<string, string>,
) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(state))
    if (value && value !== "all" && value !== "false" && value !== "1")
      parameters.set(key, value);
  const query = parameters.toString();
  window.history.replaceState(
    null,
    "",
    `#${resource}${query ? `?${query}` : ""}`,
  );
}

export function routeFromHash() {
  return (window.location.hash.slice(1).split("?")[0] || "dashboard").trim();
}
