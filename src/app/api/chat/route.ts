/**
 * POST /api/chat
 *
 * Body: { message: string, sessionId?: string, userId: string }
 *
 * Flow:
 *  1. Look up the user → roles.
 *  2. retrieve(query, { userRoles: roles, topK: 8 }) — RBAC filter applied
 *     BEFORE the top-K cut, so no chunk the user can't see is ever sent to
 *     the LLM.
 *  3. If the filter returns 0 chunks (RBAC denial): stream SAFE_MODE_MESSAGE
 *     verbatim, persist ChatMessage with denied=true, write AuditLog with
 *     denied=true. Do NOT call the LLM in this branch.
 *  4. Else: build the RAG system prompt (safe-mode instruction baked in),
 *     stream the LLM, buffer the full message, extract [^c1] citations, persist
 *     ChatMessage with denied=false, write AuditLog with denied=false.
 *  5. Append a structured footer `\n\n---CITATIONS---\n<json>` so the client
 *    can render the citation cards and the `denied` flag.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { retrieve, type RetrievedChunk } from '@/lib/retrieval'
import {
  getChatProvider,
  buildRagSystemPrompt,
  extractCitations,
} from '@/lib/ai'
import { SAFE_MODE_MESSAGE, shouldDeny, writeAuditLog } from '@/lib/audit'

export const runtime = 'nodejs'

interface ChatRequestBody {
  message: string
  sessionId?: string
  userId: string
}

export async function POST(req: NextRequest) {
  let body: ChatRequestBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const message = (body.message ?? '').trim()
  const userId = (body.userId ?? '').trim()
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const userRoles = user.roles ? user.roles.split(',').filter(Boolean) : []

  // 1. RBAC-filtered retrieval.
  const retrieved: RetrievedChunk[] = await retrieve(message, {
    userRoles,
    topK: 8,
  })
  const denied = shouldDeny(retrieved.length)

  // 2. Get or create a chat session so we can persist the conversation.
  let sessionId = body.sessionId
  if (!sessionId) {
    const title = message.slice(0, 60) + (message.length > 60 ? '…' : '')
    const session = await db.chatSession.create({ data: { title, userId } })
    sessionId = session.id
  }

  // 3. Persist the user message immediately so it isn't lost on disconnect.
  await db.chatMessage.create({
    data: { sessionId, role: 'user', content: message, denied: false },
  })

  // 4a. Safe-mode fallback: 0 chunks passed the RBAC filter.
  if (denied) {
    await db.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: SAFE_MODE_MESSAGE,
        citations: JSON.stringify([]),
        denied: true,
      },
    })
    await writeAuditLog({ userId, query: message, chunksReturned: 0, denied: true })
    await db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(SAFE_MODE_MESSAGE))
        const footer = '\n\n---CITATIONS---\n' + JSON.stringify({ sessionId, citations: [], denied: true })
        controller.enqueue(encoder.encode(footer))
        controller.close()
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Content-Type-Options': 'nosniff',
        'X-Session-Id': sessionId,
        'X-Denied': '1',
      },
    })
  }

  // 4b. Normal RAG flow: build prompt, stream LLM, extract citations.
  const priorMessages = await db.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, denied: true },
  })
  const recent = priorMessages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.denied)
    .slice(-8)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const { systemPrompt, citationMap } = buildRagSystemPrompt(retrieved, { userRoles })
  const provider = getChatProvider()
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let fullMessage = ''
      try {
        for await (const delta of provider.stream({
          systemPrompt,
          messages: [...recent, { role: 'user', content: message }],
        })) {
          fullMessage += delta
          controller.enqueue(encoder.encode(delta))
        }
      } catch (e) {
        const err = `⚠️ [stream error] ${(e as Error).message}`
        fullMessage += err
        controller.enqueue(encoder.encode(err))
      }

      // 5. Resolve cited chunk IDs from [^c1] markers + build citation cards.
      const citedChunkIds = extractCitations(fullMessage, retrieved)
      const citations = citedChunkIds
        .map((cid) => {
          const meta = citationMap[cid]
          if (!meta) return null
          const chunk = retrieved.find((r) => r.chunkId === cid)!
          return {
            chunkId: cid,
            source: meta.source,
            page: meta.page,
            ordinal: meta.ordinal,
            heading: meta.heading,
            accessTags: meta.accessTags,
            preview: meta.preview,
            url: chunk.url,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

      await db.chatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: fullMessage,
          citations: JSON.stringify(citations),
          denied: false,
        },
      })
      await writeAuditLog({ userId, query: message, chunksReturned: retrieved.length, denied: false })
      await db.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } })

      const footer =
        '\n\n---CITATIONS---\n' +
        JSON.stringify({ sessionId, citations, denied: false })
      controller.enqueue(encoder.encode(footer))
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'X-Session-Id': sessionId,
    },
  })
}
