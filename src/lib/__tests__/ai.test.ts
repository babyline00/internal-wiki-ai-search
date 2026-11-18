import { test, expect, describe } from 'bun:test'
import {
  buildRagSystemPrompt,
  extractCitations,
  type ChatProvider,
  getChatProvider,
  __setChatProviderForTest,
} from '../ai'
import { SAFE_MODE_LLM_HINT } from '../audit'
import type { RetrievedChunk } from '../retrieval'

const retrieved: RetrievedChunk[] = [
  {
    chunkId: 'ck-aaa',
    pageId: 'page-1',
    source: 'confluence',
    page: 'Architecture Notes',
    url: 'https://wiki.example/arch',
    ordinal: 1,
    heading: '## Components',
    content: 'The system is composed of three services: ingest, retrieval, and chat.',
    accessTags: ['engineering'],
    bm25Score: 4.2,
    vectorScore: 0.81,
    fusedScore: 0.016,
  },
  {
    chunkId: 'ck-bbb',
    pageId: 'page-2',
    source: 'notion',
    page: 'Onboarding',
    url: null,
    ordinal: 3,
    heading: '',
    content: 'New users land on the dashboard after signup.',
    accessTags: [],
    bm25Score: 2.1,
    vectorScore: 0.74,
    fusedScore: 0.012,
  },
]

describe('buildRagSystemPrompt', () => {
  test('includes all retrieved chunks', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt).toContain('three services')
    expect(systemPrompt).toContain('New users land')
  })
  test('includes the citation rules', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt.toLowerCase()).toContain('citation')
    expect(systemPrompt).toContain('[^c1]')
  })
  test('includes the safe-mode "I don\'t have that in the wiki" instruction', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt).toContain(SAFE_MODE_LLM_HINT)
    expect(systemPrompt.toLowerCase()).toContain('do not fabricate')
  })
  test('empty retrieved -> safe-mode prompt', () => {
    const { systemPrompt, citationMap } = buildRagSystemPrompt([])
    expect(systemPrompt.toLowerCase()).toContain('no wiki chunks')
    expect(systemPrompt).toContain(SAFE_MODE_LLM_HINT)
    expect(Object.keys(citationMap)).toHaveLength(0)
  })
  test('citation map key is the chunkId', () => {
    const { citationMap } = buildRagSystemPrompt(retrieved)
    expect(citationMap['ck-aaa'].page).toBe('Architecture Notes')
    expect(citationMap['ck-bbb'].page).toBe('Onboarding')
  })
  test('citation map card carries source + page + accessTags (full provenance)', () => {
    const { citationMap } = buildRagSystemPrompt(retrieved)
    const card = citationMap['ck-aaa']
    expect(card.source).toBe('confluence')
    expect(card.page).toBe('Architecture Notes')
    expect(card.accessTags).toEqual(['engineering'])
    expect(card.chunkId).toBe('ck-aaa')
    expect(card.preview.length).toBeGreaterThan(0)
  })
  test('includes user roles in the prompt when provided', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved, { userRoles: ['engineering', 'finance'] })
    expect(systemPrompt).toContain('engineering')
    expect(systemPrompt).toContain('finance')
    expect(systemPrompt.toLowerCase()).toContain('access roles')
  })
  test('mentions "no specific access roles" when userRoles omitted', () => {
    const { systemPrompt } = buildRagSystemPrompt(retrieved)
    expect(systemPrompt.toLowerCase()).toContain('no specific access roles')
  })
})

describe('extractCitations', () => {
  test('returns chunkIds in citation order', () => {
    const msg = 'The system has three services [^c1]. New users see the dashboard [^c2].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-aaa', 'ck-bbb'])
  })
  test('dedupes repeated citations', () => {
    const msg = 'A [^c1] then again [^c1].'
    const ids = extractCitations(msg, retrieved)
    expect(ids).toEqual(['ck-aaa'])
  })
  test('ignores out-of-range markers', () => {
    const msg = 'Bogus citation [^c99].'
    expect(extractCitations(msg, retrieved)).toEqual([])
  })
  test('no citations -> []', () => {
    expect(extractCitations('no markers here', retrieved)).toEqual([])
  })
})

describe('ChatProvider (mock)', () => {
  class MockChat implements ChatProvider {
    async *stream(args: { systemPrompt: string; messages: { role: string; content: string }[] }) {
      yield 'mocked response for: '
      yield args.messages[args.messages.length - 1].content
    }
  }
  test('streams concatenated deltas', async () => {
    __setChatProviderForTest(new MockChat())
    const provider = getChatProvider()
    const out: string[] = []
    for await (const d of provider.stream({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      out.push(d)
    }
    expect(out.join('')).toBe('mocked response for: hello')
    __setChatProviderForTest(null)
  })
})
