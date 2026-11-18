# Internal Wiki AI Search

> Enterprise wiki search with **per-page RBAC** (access tags), **source provenance** on every citation, a **"I don't have that in the wiki" safe-mode fallback**, and an **admin dashboard**. Hybrid retrieval (BM25 + vector + Reciprocal Rank Fusion), streaming chat grounded only in chunks the current user is authorised to see. Built as Project #17 of the 110-project portfolio.

---

## Overview

Most "RAG over your docs" demos assume one user with one giant pile of notes. Inside any real company, the wiki is segmented: engineering runbooks are engineering-only, finance reports are finance-only, the exec scorecard is exec-only, and a handful of pages are public. A generic chatbot that retrieved across all of it would leak confidential content across team boundaries the moment someone asked a broad question.

**Internal Wiki AI Search** is the version of personal-notes RAG that respects that boundary. Every wiki page carries `accessTags: string[]`. Every user carries `roles: string[]`. At query time the retrieval pipeline filters chunks to those where `chunk.accessTags ∩ user.roles ≠ ∅` *before* the top-K cut, so a chunk the user can't see is never even ranked — let alone sent to the LLM. If the filter returns zero chunks, the assistant emits a canonical safe-mode message and refuses to call the model at all, and the query is audited as a denial.

Citations carry full **source provenance**: `{ chunkId, source, page, ordinal, heading, accessTags, preview }` — so an admin reading the answer can see exactly which page, which upstream source system, and which access tags contributed.

---

## MVP scope

| In scope (MVP) | Stretch goals |
| --- | --- |
| Single markdown source (paste / "Add page" dialog) | Real Confluence / Notion / Slack / Drive connectors (schema already has `WikiPage.source` + `externalId` to support this) |
| Mocked users in a `User` table, role picker in the UI | Real SSO / SCIM (Okta, Azure AD, Google Workspace) |
| `roles: string[]` per user, `accessTags: string[]` per page | Per-page ACL inheritance, group/OU-based access |
| `AuditLog` table, last-10 feed in admin dashboard | Real audit log pipeline (Splunk / Datadog / SIEM), retention, alerting on denial spikes |
| Deterministic hashing-embedding (384-dim) | OpenAI `text-embedding-3-small` or Azure OpenAI (already pluggable via env) |
| `z-ai-web-dev-sdk` streaming chat | Bring-your-own LLM gateway (Anthropic, Azure, Bedrock) |

---

## Features

- **Per-page access tags** — each `WikiPage` has `accessTags: string[]`. Tags propagate to every chunk at ingest time so retrieval never has to join back to the page row.
- **Mocked user with roles** — `User` table seeded with 4 defaults (Pat Eng, Sam Finance, Rex Exec, Ada Admin). The header chip group lets you "log in as" any of them to see the wiki from their perspective. Ada Admin has `roles: ["all"]` (superuser).
- **RBAC-filtered retrieval** — `filterChunksByAccess(chunks, userRoles)` is applied to the in-memory corpus *before* the top-K cut. User with `"all"` sees everything; user with `["engineering"]` sees engineering-tagged + untagged (public) chunks; user with `[]` sees only untagged chunks.
- **Source provenance per answer** — every citation card carries `{ chunkId, source, page, ordinal, heading, accessTags, preview }`. The source badge (`manual` / `confluence` / `notion` / `slack` / `drive`) tells the reader *where* the answer came from, not just *what* it said.
- **"No answer" safe mode** — the system prompt instructs the LLM: "If retrieved chunks don't support an answer, say *'I don't have that in the wiki.'* Don't fabricate." This is the *soft* safe mode — the model is still called, it just refuses rather than hallucinates.
- **RBAC denial safe mode** — when the filter returns 0 chunks, the chat route emits `SAFE_MODE_MESSAGE` ("I don't have access to anything relevant in your wiki. Contact your admin to request access.") *without* calling the LLM, persists the assistant message with `denied = true`, and writes an `AuditLog` row with `denied = true`. The UI shows a destructive Alert above the message and a `denied` badge in the audit log.
- **Admin dashboard** — a togglable right column showing: total pages, total chunks, per-tag chunk distribution (bar chart), denied-query list (RBAC safe-mode hits), and the last 10 audit log entries (when / user / query / chunks returned / denied).
- **Streaming + inline `[^c1]` citations** — the chat route streams the LLM token-by-token, then appends a structured `\n\n---CITATIONS---\n<json>` footer so the client can render the citation cards. Markers like `[^c1]` in the message become clickable superscript chips that jump to the matching citation card.
- **Hybrid retrieval (BM25 + vector + RRF)** — Reciprocal Rank Fusion fuses the sparse BM25 ranking with the dense vector ranking using a single `k=60` smoothing constant. The hashing-embedding fallback keeps the app 100% runnable in the sandbox with zero API keys; set `EMBEDDINGS_API_KEY` to switch to a real OpenAI-compatible embeddings endpoint.
- **Idempotent imports** — `POST /api/wiki/import` is idempotent on `(source, title)`: re-importing a page with the same source + title replaces its chunks. Safe re-uploads.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | Prisma 6 + SQLite (local-first, JSON-serialised embeddings) |
| LLM / chat | `z-ai-web-dev-sdk` (streaming), mock provider fallback |
| Embeddings | Deterministic hashing-embedding (384-dim) by default; OpenAI-compatible pluggable |
| Tests | `bun test` (bun:test) — 78 unit tests across 8 modules |
| Icons | lucide-react |

---

## Architecture

```
                                    ┌──────────────────────────────────────────────────┐
                                    │                  Browser (page.tsx)               │
                                    │  Header: role picker (chip group) + Admin toggle  │
                                    │  Left:  wiki page list (RBAC-filtered)           │
                                    │  Center: streaming chat + citation cards         │
                                    │  Right:  admin dashboard (toggle)                │
                                    └──────────────────────────────────────────────────┘
                                                          │ fetch (relative paths only)
                                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              Next.js Route Handlers (Node runtime)                          │
│                                                                                             │
│  GET  /api/users            seed 4 defaults (Pat/Sam/Rex/Ada) + list    POST → create user  │
│  GET  /api/wiki?userId=..   RBAC-filtered page list                      ─                   │
│  POST /api/wiki/import      idempotent on (source, title); chunk + embed  ─                 │
│  DELETE /api/wiki/[id]      cascade chunks + invalidate corpus            ─                 │
│  POST /api/chat             retrieve → filter → safe-mode OR stream LLM   ─                 │
│  GET  /api/admin/stats      pages + chunks + perTag + last 10 audit      ─                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
              │                                │                              │
              ▼                                ▼                              ▼
   ┌───────────────────┐         ┌──────────────────────────┐      ┌─────────────────────┐
   │   src/lib/*        │         │   Prisma Client (SQLite)  │      │  z-ai-web-dev-sdk    │
   │                   │         │                          │      │  (chat completions)  │
   │  chunker.ts       │  ───►   │  User  WikiPage  WikiChunk│      │  streaming SSE       │
   │  tokenizer.ts     │         │  ChatSession ChatMessage  │      │  (or MockProvider)   │
   │  embeddings.ts    │         │  AuditLog                 │      └─────────────────────┘
   │  bm25.ts          │         └──────────────────────────┘
   │  hybrid-search.ts │                       │
   │  access-filter.ts │  ◄── filterChunksByAccess (pure)
   │  retrieval.ts     │  ◄── retrieve(query, { userRoles }) → filter BEFORE top-K
   │  audit.ts         │  ◄── shouldDeny(0) + SAFE_MODE_MESSAGE
   │  ai.ts            │  ◄── buildRagSystemPrompt(retrieved, { userRoles })
   │  seed.ts          │
   └───────────────────┘
```

### RBAC filter flow (the heart of the app)

```
User picks role in header chip group ──► currentUserId state
                    │
                    ▼
POST /api/chat { message, userId }
                    │
                    ▼
db.user.findUnique → userRoles = ["engineering"]
                    │
                    ▼
retrieve(message, { userRoles, topK: 8 })
   │
   ├─ loadCorpus() → parallel arrays of chunkId, pageId, source, page, url,
   │                  ordinal, heading, content, accessTags, tokens, vectors
   │
   ├─ filterChunksByAccess(corpus.accessTags, userRoles)  ◄── PURE FUNCTION
   │     │
   │     ├─ userRoles.includes("all") → return [...corpus] (superuser)
   │     └─ else filter to: accessTags.length === 0  OR  accessTags ∩ userRoles ≠ ∅
   │
   ├─ BM25Index over the filtered slice (rebuilt for the slice — corpus scale is fine)
   ├─ Vector cosine over the filtered slice
   ├─ Reciprocal Rank Fusion (k=60) → top-K
   │
   └─ return RetrievedChunk[]  (already RBAC-filtered, already top-K)
                    │
                    ▼
shouldDeny(retrieved.length) === 0?
   │
   ├─ YES (denied) ──► stream SAFE_MODE_MESSAGE verbatim
   │                    persist ChatMessage { denied: true }
   │                    writeAuditLog { denied: true, chunksReturned: 0 }
   │                    footer: { denied: true, citations: [] }
   │                    (LLM is NOT called)
   │
   └─ NO  ──────────► buildRagSystemPrompt(retrieved, { userRoles })
                       │
                       │  prompt instructs: "If chunks don't support an answer,
                       │                     say 'I don't have that in the wiki.'
                       │                     Don't fabricate."
                       │
                       ├─ stream LLM tokens to client
                       ├─ extractCitations(fullMessage, retrieved) → cited chunkIds
                       ├─ build citation cards (source, page, accessTags, preview)
                       ├─ persist ChatMessage { denied: false, citations: [...] }
                       └─ writeAuditLog { denied: false, chunksReturned: N }
```

### Safe-mode flow (two distinct cases)

| Case | Trigger | LLM called? | Message emitted | Audit row |
| --- | --- | --- | --- | --- |
| **RBAC denial** | `shouldDeny(retrieved.length) === true` (0 chunks passed filter) | **No** | `SAFE_MODE_MESSAGE` = "I don't have access to anything relevant in your wiki. Contact your admin to request access." | `denied = true, chunksReturned = 0` |
| **LLM grounding failure** | Chunks were retrieved but don't support the answer | Yes | `SAFE_MODE_LLM_HINT` = "I don't have that in the wiki." (LLM emits this itself per system-prompt instruction) | `denied = false, chunksReturned = N` |

These are deliberately separate. The denial case is a *security* event (the user doesn't have access); the grounding-failure case is a *correctness* event (the wiki doesn't have the answer). Auditing them as the same thing would mask real access-policy gaps.

---

## Setup

```bash
# 1. install deps (bun or npm/pnpm/yarn — bun preferred)
bun install

# 2. create the SQLite database + generate the Prisma client
bun run db:push
bun run db:generate

# 3. start the dev server
bun run dev
# → open http://localhost:3000
```

The 4 default mocked users (Pat Eng, Sam Finance, Rex Exec, Ada Admin) are seeded on first `GET /api/users` call. Use the chip group in the header to "log in as" any of them.

To add a wiki page, click **Add** in the left sidebar, paste a title + markdown content, and tag it with `engineering`, `finance`, `executive` (comma-separated, or blank for public). The page is chunked (markdown-aware), embedded (384-dim hashing by default), and stored with each chunk inheriting the page's access tags.

---

## Tests

```bash
bun test
```

78 unit tests across 8 modules, all pure-function (no DB / no network):

| File | Tests | What it pins |
| --- | ---: | --- |
| `chunker.test.ts` | 11 | Markdown-aware chunking respects heading boundaries, token budget, overlap |
| `tokenizer.test.ts` | 7 | Lowercasing, markdown stripping, CJK, URL stripping, stop-word drop |
| `embeddings.test.ts` | 7 | 384-dim Float32Array, deterministic, L2-normalised, cosine ordering |
| `bm25.test.ts` | 6 | Okapi BM25 ranking, IDF weighting, topK limit, empty corpus |
| `hybrid-search.test.ts` | 7 | Reciprocal Rank Fusion (k=60), single-retriever hits, topK |
| `ai.test.ts` | 13 | RAG system prompt: citation rules, safe-mode instruction, user-roles line, citation card provenance, `[^c1]` extraction |
| `access-filter.test.ts` | 18 | Superuser, single-role, multi-role union, no-roles = public-only, immutability, parse/serialize round-trip |
| `audit.test.ts` | 9 | `shouldDeny(0)`, `SAFE_MODE_MESSAGE` + `SAFE_MODE_LLM_HINT` constants, denial-vs-grounding contract |

Tests use `bun:test` and `bun:test`'s `expect` matchers. No jest, no vitest, no ts-node.

---

## Environment variables

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | SQLite path. Must be absolute. The `db:push` / `db:generate` / `db:migrate` scripts inline it as `DATABASE_URL="$(pwd)/db/custom.db"`. |
| `EMBEDDINGS_API_KEY` | no | (unset) | If set (or `OPENAI_API_KEY`), uses the OpenAI-compatible embeddings endpoint. Otherwise the deterministic hashing embedder. |
| `EMBEDDINGS_BASE_URL` | no | `https://api.openai.com/v1` | Override for Azure OpenAI / OpenRouter gateways. |
| `EMBEDDINGS_MODEL` | no | `text-embedding-3-small` | Model name. |
| `WIKI_DISABLE_LLM` | no | `0` | Set to `1` to force the mock chat provider (offline UI demos). |

Copy `.env.example` to `.env` and edit. The `.env` file in this repo is pre-seeded with the absolute `DATABASE_URL` for the sandbox path.

---

## Project structure

```
17-internal-wiki-ai-search/
├── prisma/
│   └── schema.prisma              # User, WikiPage, WikiChunk, ChatSession, ChatMessage, AuditLog
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout + Toaster
│   │   ├── page.tsx                # 3-column UI: page list + chat + admin dashboard
│   │   ├── globals.css             # Tailwind 4 + shadcn tokens + custom scrollbar
│   │   └── api/
│   │       ├── users/route.ts      # GET (seed defaults) + POST (create)
│   │       ├── wiki/
│   │       │   ├── route.ts        # GET ?userId=.. RBAC-filtered page list
│   │       │   ├── import/route.ts # POST idempotent on (source, title)
│   │       │   └── [id]/route.ts   # DELETE cascade chunks
│   │       ├── chat/route.ts       # POST: retrieve → filter → safe-mode OR stream
│   │       └── admin/stats/route.ts# GET: totals + per-tag + last 10 audit
│   ├── components/ui/             # shadcn/ui subset (button, card, badge, dialog, ...)
│   ├── hooks/use-toast.ts
│   └── lib/
│       ├── chunker.ts             # Markdown-aware chunker (heading boundaries + overlap)
│       ├── tokenizer.ts           # Lowercase + strip markdown + CJK + stop words
│       ├── embeddings.ts          # 384-dim hashing embedder + OpenAI-compatible provider
│       ├── bm25.ts                # Okapi BM25 (k1=1.5, b=0.75)
│       ├── hybrid-search.ts      # Reciprocal Rank Fusion (k=60)
│       ├── access-filter.ts      # filterChunksByAccess (PURE) + parse/serialize tags
│       ├── audit.ts               # shouldDeny + SAFE_MODE_MESSAGE + writeAuditLog
│       ├── retrieval.ts          # retrieve(query, { userRoles }) — RBAC-filtered hybrid
│       ├── ai.ts                  # buildRagSystemPrompt + streaming ChatProvider
│       ├── seed.ts                # Idempotent seed of 4 default users
│       ├── db.ts                  # Prisma client singleton
│       ├── utils.ts              # cn() tailwind helper
│       └── __tests__/            # 8 test files, 79 tests
├── package.json
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── tailwind.config.ts
├── components.json
├── eslint.config.mjs
├── .env / .env.example
├── .gitignore
├── LICENSE
└── README.md
```

---

## Case study

### RBAC filter design — why filter *before* the top-K cut

The naive approach is to retrieve top-K chunks across the whole corpus and then filter the results by access tags. That has two problems:

1. **Slot exhaustion.** If the top-K by relevance are all tagged `executive` and the user is `engineering`, the filtered result is empty even when perfectly good `engineering` chunks ranked just outside the top-K. The user gets a denial they shouldn't have.
2. **Side-channel leakage.** Even if you filter after retrieval, the *count* of retrieved chunks and their *scores* leak information about chunks the user can't see. A user asking the same query twice and seeing 8 citations one time and 0 the next can infer that someone added an executive-tagged page in between.

So `filterChunksByAccess` is applied to the in-memory corpus **before** BM25 / vector search run. The filtered slice gets its own BM25 index (rebuilt on the fly — corpus scale is 10²–10⁵ chunks, well within budget). The LLM only ever sees chunks the user is allowed to see, and the ranking is computed only over those chunks.

### Safe-mode flow — denial vs. grounding failure

Two distinct cases share the phrase "I don't have … in the wiki" but mean very different things:

- **RBAC denial** (security event): zero chunks passed the filter. The chat route *short-circuits the LLM entirely* — it never calls the model. It streams the canonical `SAFE_MODE_MESSAGE` verbatim, persists `ChatMessage.denied = true`, writes `AuditLog.denied = true`, and returns. The UI shows a destructive `Alert` above the message. This is the case that should alert a SOC — either the user is asking for something they shouldn't, or the access policy is misconfigured and they're missing a role they need.

- **LLM grounding failure** (correctness event): chunks *were* retrieved but they don't support the answer. The LLM is called normally; the system prompt instructs it to emit `SAFE_MODE_LLM_HINT` ("I don't have that in the wiki.") rather than fabricate. This is audited with `denied = false, chunksReturned = N`. This is the case that should prompt a content-team review — the wiki is missing the answer.

Treating them as the same thing would mask real access-policy gaps. The admin dashboard shows them in separate panels: "Denied queries" (RBAC hits) and the per-row `denied` column in the audit log.

### Source provenance — why the citation card carries `source` + `accessTags`

A citation that says "Onboarding › chunk 3" is fine for a personal wiki. An enterprise citation that says "Onboarding (notion) › chunk 3 [engineering]" tells the reader four things at once: *what* (the preview), *where* (the upstream source system), *which page* (provenance), and *who can see it* (the access tags). An admin skimming a denied query can immediately tell whether the user was denied because the page is gated by a tag they don't have, or because the page simply doesn't exist in any source.

The schema supports multiple sources via `WikiPage.source` + `WikiPage.externalId` — the MVP only writes `source = "manual"`, but the import route accepts any string, so wiring up a Confluence / Notion / Slack / Drive connector later is a per-source adapter plus a webhook, not a schema change.

### What I'd do differently

- **Real SSO/SCIM.** The role picker is a UX shortcut, not security. In production, `userId` would come from a signed session (NextAuth.js + Okta/Azure AD), `roles` would be synced from the IdP via SCIM, and the chip group would be replaced by a "logged in as Pat Eng" badge. The RBAC filter logic (`filterChunksByAccess`) stays identical — only the source of `userRoles` changes.

- **Real Confluence/Notion/Slack/Drive connectors.** The schema is ready (`WikiPage.source` + `externalId`, idempotent on `(source, title)`). Each connector is an adapter that:
  1. Fetches pages from the upstream API on a schedule (or webhook).
  2. Maps the upstream ACL to one or more of our `accessTags` (e.g. Confluence space restrictions → `engineering`, Notion shared-with-user → `finance`).
  3. POSTs to `/api/wiki/import` with the right tags.

- **Real audit log.** SQLite is fine for the demo, but a real deployment should stream `AuditLog` rows to Splunk / Datadog / a SIEM with retention + alerting. A spike in denials for one user is a signal; a spike across all users for one page is a misconfigured access tag. The `AuditLog` schema is intentionally minimal so it serialises cleanly to a SIEM event.

- **Vector DB.** The in-memory hashing embedder is great for the sandbox but caps out around 10⁵ chunks. At 10⁶+ you'd swap in pgvector / Tantivy / a hosted retrieval service — the `retrieve` function's signature doesn't change, only the corpus loader.

- **Per-page ACL inheritance.** Today, chunks inherit `accessTags` from the page verbatim. A richer model would let a page section (a heading) carry its own tags, so a single page could have a public section and a gated section. The chunker already segments by heading, so this is a schema migration + a tagger at ingest time, not an architectural change.

### Resume bullet

> Built an enterprise wiki RAG search with per-page RBAC (access tags), source provenance on every citation, and a "I don't have that in the wiki" safe-mode fallback that refuses to call the LLM when the user's role filter returns zero chunks. Hybrid retrieval (BM25 + 384-dim vector + Reciprocal Rank Fusion) applies the access-tag filter *before* the top-K cut to prevent slot exhaustion and side-channel leakage. Streaming chat with inline `[^c1]` citations, admin dashboard with per-tag chunk distribution + denied-query feed + last-10 audit log. 78 unit tests pin the chunker, tokenizer, embeddings, BM25, RRF, RBAC filter, and the safe-mode denial-vs-grounding contract. Next.js 16, TypeScript 5, Tailwind 4, shadcn/ui, Prisma 6 + SQLite, z-ai-web-dev-sdk.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Push to GitHub

```bash
gh repo create internal-wiki-ai-search --public --source=. --remote=origin --push
```
