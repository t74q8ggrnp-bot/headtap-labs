// Missing evidence is not a measured zero. Database numeric strings are
// accepted, but booleans, blank strings and coercible objects are not facts.
export function nullableAgentNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
