/**
 * RBAC access-tag filter — the heart of the "Internal Wiki AI Search" security
 * model. Each wiki chunk carries a list of `accessTags` (inherited from its
 * page at ingest time). A user carries a list of `roles`. The intersection
 * decides whether the chunk is visible to that user.
 *
 * Rules (per spec):
 *  - User with the `"all"` role is a superuser and sees EVERY chunk.
 *  - User with `["engineering"]` sees engineering-tagged chunks AND untagged
 *    chunks (untagged = "public" = visible to everyone).
 *  - User with `[]` (no roles) sees ONLY untagged (public) chunks.
 *  - A chunk with `accessTags = []` is public and visible to every user.
 *
 * The function is pure: it never mutates the input array and returns a fresh
 * array of the same element type, so it composes safely with the retrieval
 * pipeline and is trivial to unit-test in isolation.
 */

export interface AccessTagged {
  /** Tags that gate this chunk. Empty array = public (visible to everyone). */
  accessTags: string[]
}

/**
 * Returns a NEW array containing only the chunks the given user is allowed
 * to see. The input array is never mutated.
 *
 * @param chunks  any array of objects that carry an `accessTags: string[]` field
 * @param userRoles the current user's roles (e.g. ["engineering"], ["all"], [])
 */
export function filterChunksByAccess<T extends AccessTagged>(
  chunks: T[],
  userRoles: string[],
): T[] {
  // Superuser shortcut — still copy so callers can safely mutate the result.
  if (userRoles.includes('all')) {
    return [...chunks]
  }
  const roles = new Set(userRoles)
  return chunks.filter((c) => {
    // Public chunks (no access tags) are always visible.
    if (!c.accessTags || c.accessTags.length === 0) return true
    // Tagged chunks require at least one role match.
    return c.accessTags.some((t) => roles.has(t))
  })
}

/**
 * Parse a comma-joined access-tag string (as stored in SQLite) into a clean
 * array. Empty / whitespace-only entries are dropped. Tags are lowercased
 * and trimmed so `"Engineering, Finance"` and `"engineering,finance"` are
 * treated identically.
 */
export function parseAccessTags(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
}

/** Inverse of `parseAccessTags` — used when persisting chunks / pages. */
export function serializeAccessTags(tags: string[]): string {
  return tags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
    .join(',')
}
