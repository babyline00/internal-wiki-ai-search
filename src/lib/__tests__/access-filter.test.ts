/**
 * Pure-function unit tests for the RBAC access-tag filter.
 *
 * These tests pin the security model documented in the spec:
 *  - User with "all" sees EVERYTHING (superuser).
 *  - User with ["engineering"] sees engineering-tagged + untagged (public).
 *  - User with no roles sees ONLY untagged (public).
 *  - accessTags [] = public (visible to everyone).
 *  - The function is pure: it never mutates the input array and returns a
 *    fresh array (immutability).
 */
import { test, expect, describe } from 'bun:test'
import {
  filterChunksByAccess,
  parseAccessTags,
  serializeAccessTags,
  type AccessTagged,
} from '../access-filter'

interface Chunk extends AccessTagged {
  id: string
}

const corpus: Chunk[] = [
  { id: 'pub-1', accessTags: [] },                  // public
  { id: 'pub-2', accessTags: [] },                 // public
  { id: 'eng-1', accessTags: ['engineering'] },
  { id: 'eng-2', accessTags: ['engineering'] },
  { id: 'fin-1', accessTags: ['finance'] },
  { id: 'eng-fin-1', accessTags: ['engineering', 'finance'] }, // multi-tag chunk
  { id: 'exec-1', accessTags: ['executive'] },
]

describe('filterChunksByAccess — superuser', () => {
  test('user with "all" sees every chunk', () => {
    const out = filterChunksByAccess(corpus, ['all'])
    expect(out.length).toBe(corpus.length)
    const ids = out.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(corpus.map((c) => c.id)))
  })
  test('superuser result is a NEW array (immutability)', () => {
    const out = filterChunksByAccess(corpus, ['all'])
    expect(out).not.toBe(corpus)
  })
  test('"all" alongside other roles still grants superuser', () => {
    const out = filterChunksByAccess(corpus, ['engineering', 'all'])
    expect(out.length).toBe(corpus.length)
  })
})

describe('filterChunksByAccess — single role', () => {
  test('user with ["engineering"] sees engineering-tagged + public', () => {
    const out = filterChunksByAccess(corpus, ['engineering'])
    const ids = out.map((c) => c.id).sort()
    // public (pub-1, pub-2) + eng-1, eng-2 + eng-fin-1 (multi-tag chunk matches)
    expect(ids).toEqual(['eng-1', 'eng-2', 'eng-fin-1', 'pub-1', 'pub-2'])
  })
  test('user with ["finance"] sees finance-tagged + public', () => {
    const out = filterChunksByAccess(corpus, ['finance'])
    const ids = out.map((c) => c.id).sort()
    expect(ids).toEqual(['eng-fin-1', 'fin-1', 'pub-1', 'pub-2'])
  })
  test('user with ["executive"] sees executive-tagged + public (no engineering/finance)', () => {
    const out = filterChunksByAccess(corpus, ['executive'])
    const ids = out.map((c) => c.id).sort()
    expect(ids).toEqual(['exec-1', 'pub-1', 'pub-2'])
  })
})

describe('filterChunksByAccess — multi-role union', () => {
  test('user with ["engineering", "finance"] sees eng + fin + multi-tag + public', () => {
    const out = filterChunksByAccess(corpus, ['engineering', 'finance'])
    const ids = out.map((c) => c.id).sort()
    expect(ids).toEqual(['eng-1', 'eng-2', 'eng-fin-1', 'fin-1', 'pub-1', 'pub-2'])
  })
  test('user with all three roles still misses executive-only? no — exec-1 stays gated', () => {
    const out = filterChunksByAccess(corpus, ['engineering', 'finance'])
    expect(out.find((c) => c.id === 'exec-1')).toBeUndefined()
  })
})

describe('filterChunksByAccess — no roles = public only', () => {
  test('user with [] sees only untagged (public) chunks', () => {
    const out = filterChunksByAccess(corpus, [])
    const ids = out.map((c) => c.id).sort()
    expect(ids).toEqual(['pub-1', 'pub-2'])
  })
  test('user with [] does not see any tagged chunk', () => {
    const out = filterChunksByAccess(corpus, [])
    expect(out.every((c) => c.accessTags.length === 0)).toBe(true)
  })
})

describe('filterChunksByAccess — immutability', () => {
  test('does not mutate the input array', () => {
    const snapshot = corpus.map((c) => ({ ...c }))
    filterChunksByAccess(corpus, ['engineering'])
    expect(corpus).toEqual(snapshot)
    expect(corpus.length).toBe(snapshot.length)
  })
  test('returns a new array even for empty user roles', () => {
    const out = filterChunksByAccess(corpus, [])
    expect(out).not.toBe(corpus)
  })
  test('handles an empty corpus', () => {
    expect(filterChunksByAccess([], ['all'])).toEqual([])
    expect(filterChunksByAccess([], ['engineering'])).toEqual([])
    expect(filterChunksByAccess([], [])).toEqual([])
  })
})

describe('parseAccessTags / serializeAccessTags', () => {
  test('parseAccessTags splits + trims + lowercases', () => {
    expect(parseAccessTags('Engineering, Finance, executive')).toEqual(['engineering', 'finance', 'executive'])
  })
  test('parseAccessTags drops empties', () => {
    expect(parseAccessTags('a,, b, ,c')).toEqual(['a', 'b', 'c'])
  })
  test('parseAccessTags empty string -> []', () => {
    expect(parseAccessTags('')).toEqual([])
    expect(parseAccessTags('   ')).toEqual([])
  })
  test('serializeAccessTags joins + lowercases + trims', () => {
    expect(serializeAccessTags(['Engineering', 'Finance'])).toBe('engineering,finance')
    expect(serializeAccessTags([])).toBe('')
  })
  test('round-trips through parse then serialize (canonical form)', () => {
    const raw = 'Engineering, Finance'
    expect(serializeAccessTags(parseAccessTags(raw))).toBe('engineering,finance')
  })
})
