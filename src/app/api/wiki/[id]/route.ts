/**
 * DELETE /api/wiki/[id] — remove a wiki page + all its chunks.
 * The WikiChunk.page relation has onDelete: Cascade, so Prisma drops the
 * chunks automatically; we just delete the page row and invalidate the
 * in-memory retrieval corpus.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidateCorpus } from '@/lib/retrieval'

export const runtime = 'nodejs'

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const page = await db.wikiPage.findUnique({ where: { id } })
    if (!page) {
      return NextResponse.json({ error: 'Page not found' }, { status: 404 })
    }
    await db.wikiPage.delete({ where: { id } })
    invalidateCorpus()
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/wiki/:id] delete error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
