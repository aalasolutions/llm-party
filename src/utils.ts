/**
 * Convert a display name to a URL-safe tag.
 * Shared across index, orchestrator, and adapters.
 */
export function toTag(value: string): string {
  const compact = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return compact || "agent";
}
