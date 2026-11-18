/**
 * Idempotent seed for the 4 default mocked users used by the role picker.
 * Called by GET /api/users on first request if the User table is empty so the
 * UI is demoable out-of-the-box. Real SSO/SCIM is a stretch goal.
 */

import { db } from '@/lib/db'

export interface SeedUser {
  id: string
  name: string
  email: string
  roles: string[]
}

const DEFAULT_USERS: Omit<SeedUser, 'id'>[] = [
  { name: 'Pat Eng', email: 'pat.eng@example.com', roles: ['engineering'] },
  { name: 'Sam Finance', email: 'sam.finance@example.com', roles: ['finance'] },
  { name: 'Rex Exec', email: 'rex.exec@example.com', roles: ['executive'] },
  { name: 'Ada Admin', email: 'ada.admin@example.com', roles: ['all'] },
]

/**
 * Ensure the 4 default users exist. Idempotent: if a user with the default
 * email already exists, it is left untouched. Returns the full user list
 * (defaults + any created via POST /api/users).
 */
export async function seedDefaultUsersIfNeeded(): Promise<SeedUser[]> {
  const existing = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
  if (existing.length > 0) {
    return existing.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      roles: u.roles.split(',').filter(Boolean),
    }))
  }

  for (const u of DEFAULT_USERS) {
    await db.user.create({
      data: {
        name: u.name,
        email: u.email,
        roles: u.roles.join(','),
      },
    })
  }

  const created = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
  return created.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles.split(',').filter(Boolean),
  }))
}
