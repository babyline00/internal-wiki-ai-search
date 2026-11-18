/**
 * Audit + safe-mode helpers.
 *
 * The safe-mode fallback is what makes this an *enterprise* wiki search rather
 * than a generic chatbot. Two distinct cases:
 *
 *  1. RBAC denial — the user's roles intersected with the retrieved chunks
 *     yields ZERO chunks. We never call the LLM in this case; we emit the
 *     `SAFE_MODE_MESSAGE` verbatim, persist an `AuditLog` row with
 *     `denied = true`, and show a `denied` chip next to the assistant message.
 *
 *  2. LLM grounding failure — chunks were retrieved but they don't support
 *     the user's question. The system prompt instructs the model to say
 *     `SAFE_MODE_LLM_HINT` ("I don't have that in the wiki.") rather than
 *     fabricate. This case is NOT audited as denied — we got chunks back, the
 *     model just decided they didn't answer the question.
 *
 * `shouldDeny` is the pure predicate that decides case 1 vs case 2 from the
 * filtered-chunk count alone.
 */

/**
 * Emitted verbatim when RBAC returns zero chunks for the user's query.
 * Persisted as the assistant message and surfaced in the audit log.
 */
export const SAFE_MODE_MESSAGE =
  "I don't have access to anything relevant in your wiki. Contact your admin to request access."

/**
 * The phrase the LLM is instructed to use when retrieved chunks don't support
 * an answer. This is a *soft* safe mode — the LLM is still called, but it is
 * told to refuse rather than hallucinate.
 */
export const SAFE_MODE_LLM_HINT = "I don't have that in the wiki."

/**
 * Returns `true` if the RBAC filter returned zero chunks for this query.
 * This is the only condition under which we audit the query as `denied`
 * and short-circuit the LLM call.
 */
export function shouldDeny(filteredCount: number): boolean {
  return filteredCount === 0
}

/**
 * Persist a single `AuditLog` row. Kept as a tiny helper so the chat route
 * has a single audit-write seam and the schema can evolve without touching
 * the route handler.
 */
export async function writeAuditLog(args: {
  userId: string
  query: string
  chunksReturned: number
  denied: boolean
}): Promise<void> {
  // Dynamic import to keep this module pure-importable from tests that don't
  // want to spin up Prisma. The chat route is the only caller in production.
  const { db } = await import('@/lib/db')
  await db.auditLog.create({
    data: {
      userId: args.userId,
      query: args.query,
      chunksReturned: args.chunksReturned,
      denied: args.denied,
    },
  })
}
