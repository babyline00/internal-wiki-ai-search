/**
 * GET  /api/users — list mocked users (seeds 4 defaults on first call).
 * POST /api/users — create a new mocked user with roles (admin action).
 *
 * Real SSO/SCIM is a stretch goal; for the MVP the user "logged in" in the UI
 * is just a row picked from this table by the role picker chip group.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { seedDefaultUsersIfNeeded } from '@/lib/seed'
import { parseAccessTags, serializeAccessTags } from '@/lib/access-filter'

export const runtime = 'nodejs'

export async function GET() {
  const users = await seedDefaultUsersIfNeeded()
  return NextResponse.json({ users })
}

interface CreateBody {
  name: string
  email: string
  roles?: string[]
}

export async function POST(req: NextRequest) {
  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

  const roles = parseAccessTags(Array.isArray(body.roles) ? body.roles.join(',') : (body.roles ?? ''))

  try {
    const user = await db.user.create({
      data: { name, email, roles: serializeAccessTags(roles) },
    })
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        roles: user.roles.split(',').filter(Boolean),
      },
    })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 })
    }
    console.error('[api/users] create error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
