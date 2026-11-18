'use client'

import * as React from 'react'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BookOpen,
  ShieldCheck,
  Plus,
  Trash2,
  Send,
  Loader2,
  Sparkles,
  CornerDownLeft,
  Lock,
  ShieldAlert,
  LayoutDashboard,
  Users,
  FileText,
  Database,
  History,
} from 'lucide-react'

// ---------- types ----------
interface WikiUser {
  id: string
  name: string
  email: string
  roles: string[]
}

interface WikiPage {
  id: string
  source: string
  title: string
  url: string | null
  accessTags: string[]
  ingestedAt: string
  _count: { chunks: number }
}

interface Citation {
  chunkId: string
  source: string
  page: string
  ordinal: number
  heading: string
  accessTags: string[]
  preview: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  denied?: boolean
  pending?: boolean
}

interface AdminStats {
  pages: number
  chunks: number
  perTag: { tag: string; count: number }[]
  audit: {
    id: string
    userId: string
    query: string
    chunksReturned: number
    denied: boolean
    createdAt: string
  }[]
}

// ---------- helpers ----------
function renderCitationsInline(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /\[\^(c\d+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      parts.push(<React.Fragment key={`t-${last}`}>{content.slice(last, m.index)}</React.Fragment>)
    }
    const id = m[1]
    parts.push(
      <a
        key={`c-${m.index}`}
        href={`#cite-${id}`}
        className="text-primary text-xs align-super mx-0.5 px-1 rounded bg-primary/10 hover:bg-primary/20 no-underline"
      >
        [{id}]
      </a>,
    )
    last = m.index + m[0].length
  }
  if (last < content.length) {
    parts.push(<React.Fragment key={`t-${last}`}>{content.slice(last)}</React.Fragment>)
  }
  return parts
}

function fmtDate(s: string): string {
  const d = new Date(s)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const ROLE_COLORS: Record<string, string> = {
  engineering: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  finance: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  executive: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  all: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
}

function roleChipClass(role: string): string {
  return ROLE_COLORS[role] ?? 'bg-muted text-muted-foreground'
}

// ---------- main ----------
export default function Home() {
  const { toast } = useToast()

  // Users (mocked) + current "logged-in" user
  const [users, setUsers] = React.useState<WikiUser[]>([])
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null)
  const [loadingUsers, setLoadingUsers] = React.useState(true)

  // Pages visible to the current user
  const [pages, setPages] = React.useState<WikiPage[]>([])
  const [loadingPages, setLoadingPages] = React.useState(true)

  // Admin
  const [showAdmin, setShowAdmin] = React.useState(false)
  const [admin, setAdmin] = React.useState<AdminStats | null>(null)
  const [loadingAdmin, setLoadingAdmin] = React.useState(false)

  // Add-page dialog
  const [addOpen, setAddOpen] = React.useState(false)
  const [newTitle, setNewTitle] = React.useState('')
  const [newContent, setNewContent] = React.useState('')
  const [newTags, setNewTags] = useStateInput('')
  const [newSource, setNewSource] = React.useState('manual')
  const [importing, setImporting] = React.useState(false)

  // Chat
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [input, setInput] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const [sessionId, setSessionId] = React.useState<string | null>(null)

  const currentUser = React.useMemo(
    () => users.find((u) => u.id === currentUserId) ?? null,
    [users, currentUserId],
  )

  // ---------- data loaders ----------
  const refreshUsers = React.useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch('/api/users', { cache: 'no-store' })
      const json = await res.json()
      setUsers(json.users ?? [])
      if (!currentUserId && json.users?.length) {
        // Default to Ada Admin (superuser) so the demo shows full visibility.
        const ada = json.users.find((u: WikiUser) => u.roles.includes('all'))
        setCurrentUserId(ada?.id ?? json.users[0].id)
      }
    } catch (e) {
      toast({ title: 'Failed to load users', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoadingUsers(false)
    }
  }, [toast, currentUserId])

  const refreshPages = React.useCallback(async () => {
    if (!currentUserId) return
    setLoadingPages(true)
    try {
      const res = await fetch(`/api/wiki?userId=${encodeURIComponent(currentUserId)}`, { cache: 'no-store' })
      const json = await res.json()
      setPages(json.pages ?? [])
    } catch (e) {
      toast({ title: 'Failed to load pages', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoadingPages(false)
    }
  }, [toast, currentUserId])

  const refreshAdmin = React.useCallback(async () => {
    setLoadingAdmin(true)
    try {
      const res = await fetch('/api/admin/stats', { cache: 'no-store' })
      const json = await res.json()
      setAdmin(json)
    } catch (e) {
      toast({ title: 'Failed to load admin stats', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoadingAdmin(false)
    }
  }, [toast])

  React.useEffect(() => {
    refreshUsers()
  }, [refreshUsers])

  React.useEffect(() => {
    if (currentUserId) refreshPages()
  }, [currentUserId, refreshPages])

  React.useEffect(() => {
    if (showAdmin) refreshAdmin()
  }, [showAdmin, refreshAdmin])

  // ---------- handlers ----------
  async function importPage() {
    if (!newTitle.trim() || !newContent.trim()) {
      toast({ title: 'Title and content are required', variant: 'destructive' })
      return
    }
    setImporting(true)
    try {
      const tags = newTags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      const res = await fetch('/api/wiki/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          content: newContent,
          accessTags: tags,
          source: newSource || 'manual',
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      toast({
        title: `Imported "${json.page?.title ?? newTitle.trim()}"`,
        description: `Indexed ${json.chunksCreated ?? 0} chunks with ${tags.length ? tags.join(', ') : 'public'} access.`,
      })
      setNewTitle('')
      setNewContent('')
      setNewTags('')
      setAddOpen(false)
      await refreshPages()
      if (showAdmin) await refreshAdmin()
    } catch (e) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setImporting(false)
    }
  }

  async function deletePage(id: string, title: string) {
    if (!confirm(`Delete page "${title}"? Its chunks will be unindexed.`)) return
    try {
      const res = await fetch(`/api/wiki/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: 'Page deleted' })
      await refreshPages()
      if (showAdmin) await refreshAdmin()
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || streaming || !currentUser) return
    setInput('')
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text, citations: [] }
    const pendingMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: '', citations: [], pending: true }
    setMessages((m) => [...m, userMsg, pendingMsg])
    setStreaming(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId,
          userId: currentUser.id,
        }),
      })
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => 'request failed')
        throw new Error(errText)
      }
      const sid = res.headers.get('X-Session-Id')
      if (sid) setSessionId(sid)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantText = ''
      let denied = false
      let footerParsed: { sessionId?: string; citations: Citation[]; denied?: boolean } | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const sepIdx = buffer.indexOf('\n\n---CITATIONS---\n')
        let body = buffer
        if (sepIdx !== -1) {
          body = buffer.slice(0, sepIdx)
          const footerRaw = buffer.slice(sepIdx + '\n\n---CITATIONS---\n'.length)
          try {
            footerParsed = JSON.parse(footerRaw)
            if (footerParsed?.sessionId) setSessionId(footerParsed.sessionId)
            if (typeof footerParsed?.denied === 'boolean') denied = footerParsed.denied
          } catch {
            footerParsed = { citations: [] }
          }
        }
        if (body !== assistantText) {
          assistantText = body
          setMessages((m) =>
            m.map((msg) => (msg.id === pendingMsg.id ? { ...msg, content: assistantText, denied } : msg))
          )
        }
      }
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? {
                ...msg,
                pending: false,
                content: assistantText,
                citations: footerParsed?.citations ?? [],
                denied: footerParsed?.denied ?? false,
              }
            : msg
        )
      )
      if (showAdmin) await refreshAdmin()
    } catch (e) {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === pendingMsg.id
            ? { ...msg, pending: false, content: `⚠️ ${(e as Error).message}` }
            : msg
        )
      )
      toast({ title: 'Chat error', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ---------- render ----------
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-9 rounded-lg bg-primary/10 grid place-items-center shrink-0">
              <BookOpen className="size-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight truncate">Internal Wiki AI Search</h1>
              <p className="text-xs text-muted-foreground">
                {admin ? `${admin.pages} pages · ${admin.chunks} chunks indexed` : 'loading corpus…'}
              </p>
            </div>
          </div>

          {/* Role picker (chip group) */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground hidden sm:inline-flex items-center gap-1">
              <Users className="size-3.5" /> Role:
            </span>
            {loadingUsers ? (
              <Skeleton className="h-7 w-40" />
            ) : (
              users.map((u) => {
                const active = u.id === currentUserId
                return (
                  <button
                    key={u.id}
                    onClick={() => setCurrentUserId(u.id)}
                    aria-pressed={active}
                    className={
                      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium transition-colors ' +
                      (active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent')
                    }
                    title={`Log in as ${u.name} (${u.roles.join(', ') || 'no roles'})`}
                  >
                    {u.roles.includes('all') && <ShieldCheck className="size-3" />}
                    <span>{u.name}</span>
                    {u.roles.length > 0 && !u.roles.includes('all') && (
                      <span className="flex gap-0.5">
                        {u.roles.map((r) => (
                          <span key={r} className={'px-1 rounded text-[10px] ' + roleChipClass(r)}>
                            {r.slice(0, 3)}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                )
              })
            )}
            <Button
              variant={showAdmin ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowAdmin((v) => !v)}
              aria-pressed={showAdmin}
            >
              <LayoutDashboard className="size-4 mr-1.5" />
              Admin
            </Button>
          </div>
        </div>
      </header>

      {/* Main 3-column layout. Admin column is conditionally rendered. */}
      <main
        className={
          'flex-1 grid grid-cols-1 gap-0 ' +
          (showAdmin
            ? 'lg:grid-cols-[280px_1fr_320px]'
            : 'lg:grid-cols-[280px_1fr]')
        }
      >
        {/* Left — wiki page list */}
        <aside className="border-r bg-muted/30 lg:sticky lg:top-[64px] lg:h-[calc(100vh-64px)] lg:overflow-hidden flex flex-col">
          <div className="p-4 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <FileText className="size-4" /> Wiki pages
            </h2>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-1" /> Add
            </Button>
          </div>
          <Separator />
          <div className="px-3 py-2 text-[11px] text-muted-foreground border-b bg-background/60">
            {currentUser ? (
              <span className="flex items-center gap-1">
                <ShieldCheck className="size-3" />
                Visible to <strong className="text-foreground">{currentUser.name}</strong>
                {currentUser.roles.length > 0 ? ` (${currentUser.roles.join(', ')})` : ' (no roles — public only)'}
              </span>
            ) : (
              <span>Pick a user to filter pages by access.</span>
            )}
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto scrollbar-thin">
              {loadingPages ? (
                <>
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </>
              ) : pages.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No pages visible to this user. Click <strong>Add</strong> to paste a new wiki page (you can tag it
                  with <code>engineering</code>, <code>finance</code>, <code>executive</code>, or leave it blank for
                  public).
                </div>
              ) : (
                pages.map((p) => (
                  <Card key={p.id} className="p-3 hover:bg-muted/40 transition-colors gap-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium line-clamp-2">{p.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                          <Badge variant="outline" className="px-1 py-0 text-[10px]">{p.source}</Badge>
                          <span>{p._count.chunks} chunks</span>
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {p.accessTags.length === 0 ? (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">public</Badge>
                          ) : (
                            p.accessTags.map((t) => (
                              <span
                                key={t}
                                className={'text-[10px] px-1.5 py-0.5 rounded ' + roleChipClass(t)}
                              >
                                {t}
                              </span>
                            ))
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 mt-1">{fmtDate(p.ingestedAt)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 -mr-1 -mt-1 text-muted-foreground hover:text-destructive"
                        onClick={() => deletePage(p.id, p.title)}
                        aria-label={`Delete ${p.title}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </aside>

        {/* Center — chat */}
        <section className="flex flex-col min-h-[60vh] lg:h-[calc(100vh-64px)]">
          <ScrollArea className="flex-1">
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
              {messages.length === 0 ? (
                <EmptyState hasPages={pages.length > 0} currentUser={currentUser} />
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
            </div>
          </ScrollArea>

          {/* Composer */}
          <div className="border-t bg-background/95 backdrop-blur p-3">
            <div className="max-w-3xl mx-auto">
              <div className="relative">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={
                    currentUser
                      ? `Ask the wiki as ${currentUser.name}… (Enter to send, Shift+Enter for newline)`
                      : 'Pick a user first…'
                  }
                  className="pr-12 min-h-[44px] max-h-44 resize-y"
                  disabled={streaming || !currentUser}
                />
                <Button
                  size="icon"
                  className="absolute right-1.5 bottom-1.5 size-8"
                  onClick={sendMessage}
                  disabled={streaming || !input.trim() || !currentUser}
                  aria-label="Send message"
                >
                  {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-1 flex items-center gap-1 flex-wrap">
                <CornerDownLeft className="size-3" /> to send
                <span className="mx-1">·</span>
                <Sparkles className="size-3" /> RAG with inline [^c1] citations
                <span className="mx-1">·</span>
                <Lock className="size-3" /> RBAC-filtered
                {currentUser && (
                  <>
                    <span className="mx-1">·</span>
                    <span className="text-foreground/70">roles: {currentUser.roles.join(', ') || '∅'}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Right — admin dashboard (conditional) */}
        {showAdmin && (
          <aside className="border-l bg-muted/30 lg:sticky lg:top-[64px] lg:h-[calc(100vh-64px)] lg:overflow-hidden flex flex-col">
            <div className="p-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <LayoutDashboard className="size-4" /> Admin dashboard
              </h2>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => refreshAdmin()} disabled={loadingAdmin}>
                {loadingAdmin ? <Loader2 className="size-3 animate-spin" /> : <Database className="size-3.5" />}
                Refresh
              </Button>
            </div>
            <Separator />
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4 max-h-[calc(100vh-160px)] overflow-y-auto scrollbar-thin">
                {loadingAdmin && !admin ? (
                  <>
                    <Skeleton className="h-20 w-full" />
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-48 w-full" />
                  </>
                ) : admin ? (
                  <AdminPanel admin={admin} />
                ) : (
                  <p className="text-xs text-muted-foreground">No stats yet.</p>
                )}
              </div>
            </ScrollArea>
          </aside>
        )}
      </main>

      {/* Add-page dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add wiki page</DialogTitle>
            <DialogDescription>
              Paste the page markdown. Each heading (<code>#</code>, <code>##</code>, …) starts a new chunk. Tag
              the page with the access roles that should be able to retrieve it (comma-separated); leave blank for
              public.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="page-title">Title</Label>
              <Input
                id="page-title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Engineering Onboarding"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="page-source">Source</Label>
              <Input
                id="page-source"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                placeholder="manual | confluence | notion | slack | drive"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="page-tags">Access tags (comma-separated, blank = public)</Label>
              <Input
                id="page-tags"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                placeholder="e.g. engineering, finance"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="page-content">Content (markdown)</Label>
              <Textarea
                id="page-content"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={'# Onboarding\n\nNew engineers start by cloning the repo and running `bun install`.\n\n## First week\n\nPair with your buddy on the first ticket.'}
                className="min-h-[200px] font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={importPage} disabled={importing}>
              {importing ? <Loader2 className="size-4 mr-1.5 animate-spin" /> : <Plus className="size-4 mr-1.5" />}
              Save & index
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Tiny wrapper so we can use a stateful input helper without importing useState twice in JSX scope.
function useStateInput(initial: string): [string, (v: string) => void] {
  const [v, setV] = React.useState(initial)
  return [v, setV]
}

// ---------- sub-components ----------
function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] ${isUser ? 'order-2' : ''}`}>
        {message.denied && !message.pending && (
          <Alert variant="destructive" className="mb-2">
            <ShieldAlert className="size-4" />
            <AlertTitle>Safe-mode fallback</AlertTitle>
            <AlertDescription>
              The RBAC filter returned zero chunks for your roles. The assistant did not call the model.
            </AlertDescription>
          </Alert>
        )}
        <div
          className={
            isUser
              ? 'rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm whitespace-pre-wrap'
              : 'rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap'
          }
        >
          {isUser ? message.content : renderCitationsInline(message.content)}
          {message.pending && (
            <span className="inline-flex items-center gap-1 ml-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
            </span>
          )}
        </div>
        {!isUser && message.citations.length > 0 && !message.pending && (
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <FileText className="size-3" /> Sources ({message.citations.length})
            </p>
            {message.citations.map((c, i) => (
              <a
                key={c.chunkId}
                id={`cite-c${i + 1}`}
                href="#"
                className="block text-xs bg-background border rounded-md p-2 hover:border-primary/40 transition-colors no-underline"
                onClick={(e) => e.preventDefault()}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground line-clamp-1">{c.page}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0">c{i + 1}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  <Badge variant="outline" className="text-[9px] px-1 py-0 mr-1">{c.source}</Badge>
                  {c.heading && <>{c.heading} · </>}
                  chunk {c.ordinal}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {c.accessTags.length === 0 ? (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">public</Badge>
                  ) : (
                    c.accessTags.map((t) => (
                      <span key={t} className={'text-[9px] px-1 py-0.5 rounded ' + roleChipClass(t)}>
                        {t}
                      </span>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground/80 mt-1 line-clamp-2">{c.preview}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ hasPages, currentUser }: { hasPages: boolean; currentUser: WikiUser | null }) {
  return (
    <div className="py-16 text-center max-w-md mx-auto">
      <div className="size-14 rounded-full bg-primary/10 grid place-items-center mx-auto mb-4">
        <Sparkles className="size-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold mb-2">Search your internal wiki</h2>
      <p className="text-sm text-muted-foreground">
        {currentUser
          ? hasPages
            ? `Ask a question — answers are grounded only in pages ${currentUser.name} is authorised to see, with inline citations + full source provenance.`
            : `No pages are visible to ${currentUser.name} yet. Click "Add" in the left sidebar to paste a wiki page (tag it with ${currentUser.roles.join(', ') || 'a role'} or leave it public).`
          : 'Pick a user in the header to start asking questions.'}
      </p>
    </div>
  )
}

function AdminPanel({ admin }: { admin: AdminStats }) {
  const denied = admin.audit.filter((a) => a.denied)
  return (
    <div className="space-y-4">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-3 py-3 gap-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="size-3.5" /> Pages
          </div>
          <p className="text-2xl font-semibold tabular-nums">{admin.pages}</p>
        </Card>
        <Card className="p-3 py-3 gap-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database className="size-3.5" /> Chunks
          </div>
          <p className="text-2xl font-semibold tabular-nums">{admin.chunks}</p>
        </Card>
      </div>

      {/* Per-tag distribution */}
      <div>
        <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
          <ShieldCheck className="size-3.5" /> Per-tag chunk distribution
        </h3>
        {admin.perTag.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tagged chunks yet. All chunks are public.</p>
        ) : (
          <div className="space-y-1.5">
            {admin.perTag.map((t) => {
              const max = Math.max(...admin.perTag.map((x) => x.count), 1)
              const pct = Math.round((t.count / max) * 100)
              return (
                <div key={t.tag} className="flex items-center gap-2">
                  <span className={'text-[10px] px-1.5 py-0.5 rounded w-20 text-center ' + roleChipClass(t.tag)}>
                    {t.tag}
                  </span>
                  <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs tabular-nums w-8 text-right">{t.count}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Denied queries */}
      <div>
        <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
          <ShieldAlert className="size-3.5" /> Denied queries (RBAC safe-mode hits)
        </h3>
        {denied.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet. Denied queries appear when a user's role filter returns zero chunks.</p>
        ) : (
          <ul className="text-xs space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
            {denied.slice(0, 10).map((a) => (
              <li key={a.id} className="border rounded p-1.5 bg-destructive/5">
                <p className="line-clamp-1">"{a.query}"</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  user {a.userId.slice(-6)} · {fmtDate(a.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Last 10 audit entries */}
      <div>
        <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
          <History className="size-3.5" /> Last 10 audit log entries
        </h3>
        {admin.audit.length === 0 ? (
          <p className="text-xs text-muted-foreground">No queries yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 text-[10px]">When</TableHead>
                <TableHead className="h-7 text-[10px]">User</TableHead>
                <TableHead className="h-7 text-[10px]">Query</TableHead>
                <TableHead className="h-7 text-[10px] text-right">Chunks</TableHead>
                <TableHead className="h-7 text-[10px] text-center">Denied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admin.audit.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-[10px] py-1">{fmtDate(a.createdAt)}</TableCell>
                  <TableCell className="text-[10px] py-1 font-mono">{a.userId.slice(-6)}</TableCell>
                  <TableCell className="text-[10px] py-1 max-w-[140px] truncate" title={a.query}>{a.query}</TableCell>
                  <TableCell className="text-[10px] py-1 text-right tabular-nums">{a.chunksReturned}</TableCell>
                  <TableCell className="text-[10px] py-1 text-center">
                    {a.denied ? <Badge variant="destructive" className="text-[9px] px-1 py-0">yes</Badge> : <span className="text-muted-foreground">no</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
