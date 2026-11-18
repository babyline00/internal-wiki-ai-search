/**
 * Pure-function unit tests for the audit + safe-mode helpers.
 *
 * `shouldDeny` is the predicate that decides whether the chat route emits
 * the canonical SAFE_MODE_MESSAGE without calling the LLM, and whether the
 * AuditLog row is persisted with denied=true.
 */
import { test, expect, describe } from 'bun:test'
import { shouldDeny, SAFE_MODE_MESSAGE, SAFE_MODE_LLM_HINT } from '../audit'

describe('shouldDeny', () => {
  test('returns true when 0 chunks passed the RBAC filter', () => {
    expect(shouldDeny(0)).toBe(true)
  })
  test('returns false when at least 1 chunk passed', () => {
    expect(shouldDeny(1)).toBe(false)
    expect(shouldDeny(8)).toBe(false)
    expect(shouldDeny(100)).toBe(false)
  })
  test('does NOT treat negative counts as denied (defensive — never expected in practice)', () => {
    // The contract is "denied === 0 chunks"; negative counts are a bug, not a denial.
    expect(shouldDeny(-1)).toBe(false)
  })
})

describe('SAFE_MODE_MESSAGE', () => {
  test('is the canonical RBAC-denial message shown to the user', () => {
    expect(SAFE_MODE_MESSAGE).toContain("I don't have access to anything relevant in your wiki")
    expect(SAFE_MODE_MESSAGE).toContain('Contact your admin to request access')
  })
  test('is a stable string (snapshot-worthy)', () => {
    expect(typeof SAFE_MODE_MESSAGE).toBe('string')
    expect(SAFE_MODE_MESSAGE.length).toBeGreaterThan(40)
  })
})

describe('SAFE_MODE_LLM_HINT', () => {
  test('is the phrase the LLM is instructed to use when chunks don\'t support an answer', () => {
    expect(SAFE_MODE_LLM_HINT).toBe("I don't have that in the wiki.")
  })
  test('is distinct from the RBAC-denial message', () => {
    expect(SAFE_MODE_LLM_HINT).not.toBe(SAFE_MODE_MESSAGE)
  })
})

describe('safe-mode flow (integration-by-contract)', () => {
  test('denial path: shouldDeny(0) => SAFE_MODE_MESSAGE is what the chat route would emit', () => {
    if (shouldDeny(0)) {
      // The chat route short-circuits the LLM and streams SAFE_MODE_MESSAGE verbatim.
      expect(SAFE_MODE_MESSAGE).toContain("I don't have access")
    } else {
      throw new Error('shouldDeny(0) should be true')
    }
  })
  test('non-denial path: shouldDeny(>0) => LLM is called and may emit SAFE_MODE_LLM_HINT', () => {
    if (!shouldDeny(3)) {
      // The LLM is called; if its grounding fails it emits SAFE_MODE_LLM_HINT instead of fabricating.
      expect(SAFE_MODE_LLM_HINT).toContain("I don't have that in the wiki")
    } else {
      throw new Error('shouldDeny(3) should be false')
    }
  })
})
