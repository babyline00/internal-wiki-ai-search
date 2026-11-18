/**
 * GET /api/wiki?userId=<id>
 *
 * Lists wiki pages the given user is allowed to see. RBAC filter:
 *  - user with role "all" sees every page
 *  - user with role R sees pages tagged with R AND untagged (public) pages
 *  - user with no roles sees only untagged (public) pages
 *
 * Each page includes its source badge, access tags, ingest date and chunk
 * count so the left sidebar can render the page list with full provenance.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { filterChunksByAccess, parseAccessTags } from '@/lib/access-filter'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userRoles = user.roles ? user.roles.split(',').filter(Boolean) : []

  const allPages = await db.wikiPage.findMany({
    orderBy: { ingestedAt: 'desc' },
    select: {
      id: true,
      source: true,
      externalId: true,
      title: true,
      url: true,
      accessTags: true,
      ingestedAt: true,
      _count: { select: { chunks: true } },
    },
  })

  // Apply the same pure RBAC filter used at retrieval time so the page list
  // and the chat retrieval always agree on what the user can see.
  const tagged = allPages.map((p) => ({
    ...p,
    accessTagsArr: parseAccessTags(p.accessTags),
  }))
  const visible = filterChunksByAccess(
    tagged.map((p) => ({ accessTags: p.accessTagsArr, _page: p })),
    userRoles,
  )

  const pages = visible.map((v) => {
    const p = (v as any)._page
    return {
      id: p.id,
      source: p.source,
      externalId: p.externalId,
      title: p.title,
      url: p.url,
      accessTags: p.accessTagsArr,
      ingestedAt: p.ingestedAt,
      _count: p._count,
    }
  })

  return NextResponse.json({ pages, userRoles })
}
