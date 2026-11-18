/**
 * POST /api/wiki/import
 *
 * Body: { title: string, content: string, accessTags?: string[], source?: string, url?: string }
 *
 * Idempotent on (source, title): re-importing a page with the same source +
 * title replaces its chunks. This makes re-uploads safe.
 *
 * Each chunk inherits the page's access tags so the RBAC filter at retrieval
 * time only has to look at the chunk row (no join needed).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chunkMarkdown } from '@/lib/chunker'
import { tokenize } from '@/lib/tokenizer'
import { getEmbeddingProvider, serializeVector } from '@/lib/embeddings'
import { invalidateCorpus } from '@/lib/retrieval'
import { parseAccessTags, serializeAccessTags } from '@/lib/access-filter'

export const runtime = 'nodejs'

interface ImportBody {
  title: string
  content: string
  accessTags?: string[]
  source?: string
  url?: string
  externalId?: string
}

export async function POST(req: NextRequest) {
  let body: ImportBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const title = (body.title ?? '').trim()
  const content = body.content ?? ''
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })
  if (!content.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const source = (body.source ?? 'manual').trim() || 'manual'
  const tags = parseAccessTags(Array.isArray(body.accessTags) ? body.accessTags.join(',') : (body.accessTags ?? ''))
  const tagsStr = serializeAccessTags(tags)

  try {
    // Idempotent on (source, title): replace if exists.
    const existing = await db.wikiPage.findUnique({
      where: { source_title: { source, title } },
    })
    if (existing) {
      await db.wikiChunk.deleteMany({ where: { pageId: existing.id } })
      await db.wikiPage.delete({ where: { id: existing.id } })
    }

    const page = await db.wikiPage.create({
      data: {
        source,
        externalId: body.externalId ?? null,
        title,
        url: body.url ?? null,
        content,
        accessTags: tagsStr,
      },
    })

    const provider = getEmbeddingProvider()
    const chunks = chunkMarkdown(content)
    for (const chunk of chunks) {
      const tokens = tokenize(chunk.content)
      const vec = await provider.embed(chunk.content)
      await db.wikiChunk.create({
        data: {
          pageId: page.id,
          ordinal: chunk.ordinal,
          heading: chunk.heading,
          content: chunk.content,
          tokens: JSON.stringify(tokens),
          embedding: serializeVector(vec),
          accessTags: tagsStr, // chunk inherits page tags
        },
      })
    }

    invalidateCorpus()

    return NextResponse.json({
      ok: true,
      page: { id: page.id, title: page.title, source: page.source, accessTags: tags },
      chunksCreated: chunks.length,
      replaced: !!existing,
    })
  } catch (e) {
    console.error('[api/wiki/import] error:', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Internal Server Error' },
      { status: 500 },
    )
  }
}
