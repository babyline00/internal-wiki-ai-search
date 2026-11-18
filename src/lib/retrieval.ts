/**
 * Retrieval service — given a user query and the current user's roles, returns
 * the top-K most relevant chunks the user is ALLOWED to see, via hybrid
 * (BM25 + vector) retrieval with Reciprocal Rank Fusion.
 *
 * The RBAC access-tag filter is applied to the in-memory corpus BEFORE the
 * top-K cut so we never waste retrieval slots on chunks the user can't see.
 * This is the "RBAC-filtered retrieval" step called out in the spec.
 *
 * The corpus is loaded into memory on first use and rebuilt when pages are
 * added / removed. For the wiki scale (10^2-10^5 chunks) in-memory is the
 * right choice; for larger corpora this is where you would swap in
 * pgvector / Tantivy / a hosted retrieval service.
 */

import { db } from '@/lib/db'
import { tokenize } from '@/lib/tokenizer'
import { BM25Index } from '@/lib/bm25'
import {
  getEmbeddingProvider,
  cosine,
  deserializeVector,
  type EmbeddingProvider,
} from '@/lib/embeddings'
import { fuseHits } from '@/lib/hybrid-search'
import { filterChunksByAccess, parseAccessTags } from '@/lib/access-filter'

export interface RetrievedChunk {
  chunkId: string
  pageId: string
  source: string
  page: string   // page title
  url: string | null
  ordinal: number
  heading: string
  content: string
  accessTags: string[]
  bm25Score: number
  vectorScore: number
  fusedScore: number
}

const TOP_K = 8

interface CorpusState {
  chunkIds: string[]
  pageIds: string[]
  sources: string[]
  pageTitles: string[]
  urls: (string | null)[]
  ordinals: number[]
  headings: string[]
  contents: string[]
  accessTags: string[][]
  tokens: string[][]
  vectors: Float32Array[]
  bm25: BM25Index
  signature: string
}

let corpusState: CorpusState | null = null

async function computeCorpusSignature(): Promise<string> {
  const count = await db.wikiChunk.count()
  const latest = await db.wikiChunk.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } })
  return `${count}:${latest?.id ?? ''}`
}

async function loadCorpus(provider: EmbeddingProvider): Promise<CorpusState> {
  const chunks = await db.wikiChunk.findMany({
    include: { page: { select: { title: true, source: true, url: true } } },
    orderBy: { ordinal: 'asc' },
  })

  const chunkIds: string[] = []
  const pageIds: string[] = []
  const sources: string[] = []
  const pageTitles: string[] = []
  const urls: (string | null)[] = []
  const ordinals: number[] = []
  const headings: string[] = []
  const contents: string[] = []
  const accessTags: string[][] = []
  const tokens: string[][] = []
  const vectors: Float32Array[] = []

  for (const c of chunks) {
    chunkIds.push(c.id)
    pageIds.push(c.pageId)
    sources.push(c.page.source)
    pageTitles.push(c.page.title)
    urls.push(c.page.url)
    ordinals.push(c.ordinal)
    headings.push(c.heading)
    contents.push(c.content)
    accessTags.push(parseAccessTags(c.accessTags))
    try {
      tokens.push(JSON.parse(c.tokens) as string[])
    } catch {
      tokens.push(tokenize(c.content))
    }
    try {
      vectors.push(deserializeVector(c.embedding))
    } catch {
      vectors.push(await provider.embed(c.content))
    }
  }

  return {
    chunkIds,
    pageIds,
    sources,
    pageTitles,
    urls,
    ordinals,
    headings,
    contents,
    accessTags,
    tokens,
    vectors,
    bm25: new BM25Index(tokens.map((t, i) => ({ id: chunkIds[i], tokens: t }))),
    signature: await computeCorpusSignature(),
  }
}

async function getCorpus(): Promise<CorpusState> {
  const sig = await computeCorpusSignature()
  if (corpusState && corpusState.signature === sig) {
    return corpusState
  }
  const provider = getEmbeddingProvider()
  corpusState = await loadCorpus(provider)
  return corpusState
}

/** Force a reload on next access — used by the import API after adding pages. */
export function invalidateCorpus() {
  corpusState = null
}

export interface RetrieveOptions {
  /**
   * Roles of the current user. Chunks are filtered to those whose accessTags
   * intersect the user's roles (or the user has "all", or the chunk is
   * untagged = public). If omitted, only public chunks are searched.
   */
  userRoles?: string[]
  topK?: number
}

export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const topK = opts.topK ?? TOP_K
  const userRoles = opts.userRoles ?? []
  const corpus = await getCorpus()
  if (!corpus.chunkIds.length) return []

  // 1. Apply the RBAC access-tag filter on the in-memory corpus BEFORE the
  //    top-K cut. The filter returns the indices the user is allowed to see.
  //    We wrap the parallel arrays in a transient AccessTagged view so the
  //    pure filter function can operate on them without restructuring.
  const taggedView = corpus.accessTags.map((tags, i) => ({
    accessTags: tags,
    _idx: i,
  }))
  const visible = filterChunksByAccess(taggedView, userRoles)
  const filteredIdx = visible.map((v) => v._idx)
  if (!filteredIdx.length) return []

  // 2. Run BM25 over the filtered slice.
  const filteredDocs = filteredIdx.map((i) => ({
    id: corpus.chunkIds[i],
    tokens: corpus.tokens[i],
  }))
  const subBm25 = new BM25Index(filteredDocs)
  const bm25Hits = subBm25.search(query, topK * 2)

  // 3. Vector similarity over the filtered slice.
  const provider = getEmbeddingProvider()
  const qVec = await provider.embed(query)
  const vecHits = filteredIdx
    .map((i) => ({
      id: corpus.chunkIds[i],
      score: cosine(qVec, corpus.vectors[i]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)

  // 4. RRF fuse + take top-K.
  const fused = fuseHits(
    bm25Hits.map((h) => ({ id: h.id, score: h.score })),
    vecHits.map((h) => ({ id: h.id, score: h.score })),
    { topK },
  )

  const idToIdx = new Map(corpus.chunkIds.map((id, i) => [id, i]))
  return fused.map((f): RetrievedChunk => {
    const i = idToIdx.get(f.id)!
    return {
      chunkId: corpus.chunkIds[i],
      pageId: corpus.pageIds[i],
      source: corpus.sources[i],
      page: corpus.pageTitles[i],
      url: corpus.urls[i],
      ordinal: corpus.ordinals[i],
      heading: corpus.headings[i],
      content: corpus.contents[i],
      accessTags: corpus.accessTags[i],
      bm25Score: f.bm25Score,
      vectorScore: f.vectorScore,
      fusedScore: f.fusedScore,
    }
  })
}

/** Total page + chunk counts — used by the admin dashboard. */
export async function corpusStats(): Promise<{ pages: number; chunks: number }> {
  const pages = await db.wikiPage.count()
  const chunks = await db.wikiChunk.count()
  return { pages, chunks }
}
