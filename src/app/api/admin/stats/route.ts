/**
 * GET /api/admin/stats
 *
 * Returns the admin dashboard payload:
 *  - pages: total WikiPage count
 *  - chunks: total WikiChunk count
 *  - perTag: [{ tag, count }] — chunk counts grouped by access tag. Tags are
 *    parsed from the comma-joined WikiChunk.accessTags string. Public chunks
 *    (empty accessTags) appear under the "public" bucket.
 *  - audit: last 10 AuditLog rows (newest first)
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseAccessTags } from '@/lib/access-filter'

export const runtime = 'nodejs'

export async function GET() {
  const pages = await db.wikiPage.count()
  const chunks = await db.wikiChunk.count()

  // Per-tag distribution — iterate chunks once, tally each tag.
  const allChunks = await db.wikiChunk.findMany({ select: { accessTags: true } })
  const tagCounts = new Map<string, number>()
  for (const c of allChunks) {
    const tags = parseAccessTags(c.accessTags)
    if (tags.length === 0) {
      tagCounts.set('public', (tagCounts.get('public') ?? 0) + 1)
    } else {
      for (const t of tags) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
      }
    }
  }
  const perTag = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)

  const audit = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      userId: true,
      query: true,
      chunksReturned: true,
      denied: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ pages, chunks, perTag, audit })
}
