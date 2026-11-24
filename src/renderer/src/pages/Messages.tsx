import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Conversation, ConversationThread, MessagesResult } from '../../../shared/types'

/**
 * Page Messages : conversations Steam + Xbox regroupées.
 * Volontairement utile même à vide — la page explique toujours POURQUOI une plateforme
 * ne renvoie rien (non connectée, boîte vide, API fermée) plutôt que d'afficher un blanc.
 */

function relative(ts: number | null): string {
  if (!ts) return ''
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return "à l'instant"
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.round(h / 24)
  return j <= 30 ? `il y a ${j} j` : new Date(ts).toLocaleDateString('fr-FR')
}

const BADGE: Record<Conversation['platform'], { label: string; cls: string }> = {
  steam: { label: 'Steam', cls: 'bg-[#1b2838] text-[#66c0f4] ring-1 ring-[#66c0f4]/30' },
  xbox: { label: 'Xbox', cls: 'bg-[#107c10]/15 text-[#6ee06e] ring-1 ring-[#6ee06e]/30' }
}

function Avatar({ c }: { c: Conversation }): React.JSX.Element {
  if (c.avatarUrl)
    return <img src={c.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover" />
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-vault-accent to-vault-accent2 text-sm font-black text-white">
      {c.name.slice(0, 2).toUpperCase()}
    </div>
  )
}

function PlatformNote({
  label,
  connected,
  note
}: {
  label: string
  connected: boolean
  note: string | null
}): React.JSX.Element | null {
  if (!note) return null
  return (
    <div className="flex items-start gap-2 rounded-xl border border-vault-border/70 bg-white/[0.02] px-3.5 py-2.5">
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-amber-400' : 'bg-vault-muted'}`} />
      <p className="text-xs text-vault-muted">
        <span className="font-semibold text-vault-text">{label}</span> — {note}
      </p>
    </div>
  )
}

/** Fil de discussion ouvert : historique + zone de réponse. */
function Thread({
  conv,
  onClose,
  onSent
}: {
  conv: Conversation
  onClose: () => void
  onSent: () => void
}): React.JSX.Element {
  const [thread, setThread] = useState<ConversationThread | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  /**
   * Recharge le fil depuis Xbox. Les messages ajoutés en local juste après un envoi sont
   * CONSERVÉS tant que Xbox ne les a pas encore publiés (quelques secondes de décalage) :
   * sans ça, le message qu'on vient d'écrire disparaissait de l'écran après le rechargement.
   */
  const load = useCallback(async (): Promise<void> => {
    const fresh = await window.api.getConversation(conv.peerId)
    setThread((prev) => {
      if (!prev) return fresh
      const known = new Set(fresh.messages.map((m) => m.id))
      const pending = prev.messages.filter((m) => m.pending && !known.has(m.id))
      if (pending.length === 0) return fresh
      return { ...fresh, messages: [...fresh.messages, ...pending] }
    })
  }, [conv.peerId])

  useEffect(() => {
    void load()
  }, [load])

  // Rafraîchissement automatique : les réponses de l'ami arrivent sans avoir à rouvrir le fil.
  useEffect(() => {
    const id = setInterval(() => void load(), 15_000)
    return () => clearInterval(id)
  }, [load])

  // colle le fil en bas à chaque arrivée de message, comme une messagerie classique
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [thread])

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    // try/catch indispensable : sans lui, un échec de l'IPC laissait le bouton bloqué sur « … »
    // et n'affichait AUCUNE erreur — l'envoi semblait ne rien faire du tout.
    try {
      const r = await window.api.sendMessage(conv.peerId, text)
      if (!r.ok) {
        setError(r.error ?? "L'envoi a échoué.")
        return
      }
      setDraft('')
      // Affichage immédiat : Xbox accepte le message mais met quelques secondes à le publier
      // dans l'historique. Sans cet ajout local, l'écran restait inchangé après l'envoi et on
      // croyait que rien n'était parti — alors que si.
      setThread((prev) =>
        prev
          ? {
              ...prev,
              messages: [
                ...prev.messages,
                { id: r.messageId ?? `local-${Date.now()}`, mine: true, text, at: Date.now(), pending: true }
              ]
            }
          : prev
      )
      onSent()
      void load()
    } catch (e) {
      setError(`Envoi impossible : ${(e as Error).message}`)
    } finally {
      setSending(false)
    }
  }

  const steamLocked = conv.platform === 'steam'

  return (
    <div className="glass flex h-[calc(100vh-13rem)] flex-col rounded-2xl">
      <div className="flex items-center gap-3 border-b border-vault-border/60 p-4">
        <button
          onClick={onClose}
          className="rounded-lg border border-vault-border px-2.5 py-1 text-sm transition hover:border-vault-accent/50"
        >
          ←
        </button>
        <Avatar c={conv} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{thread?.name || conv.name}</p>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${BADGE[conv.platform].cls}`}>
            {BADGE[conv.platform].label}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {steamLocked ? (
          <p className="mt-8 text-center text-xs text-vault-muted">
            Steam ne donne accès au contenu des conversations qu'à travers son propre client :
            impossible de lire ou d'écrire ce fil depuis All Access.
          </p>
        ) : thread === null ? (
          <p className="mt-8 text-center text-xs text-vault-muted">Chargement du fil…</p>
        ) : thread.error ? (
          <p className="mt-8 text-center text-xs text-amber-400">Fil indisponible : {thread.error}</p>
        ) : thread.messages.length === 0 ? (
          <p className="mt-8 text-center text-xs text-vault-muted">
            Aucun message pour l'instant — écris le premier.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {thread.messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                    m.mine
                      ? 'bg-gradient-to-br from-vault-accent to-vault-accent2 text-white'
                      : 'border border-vault-border bg-white/[0.04]'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={`mt-1 text-[10px] ${m.mine ? 'text-white/70' : 'text-vault-muted'}`}>
                    {m.at ? new Date(m.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                    {m.pending && ' · envoyé ✓'}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {!steamLocked && (
        <div className="border-t border-vault-border/60 p-3">
          {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Entrée = envoyer, Maj+Entrée = nouvelle ligne
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={1}
              placeholder="Écris ta réponse… (Entrée pour envoyer)"
              className="max-h-32 min-h-[42px] flex-1 resize-y rounded-xl border border-vault-border bg-white/[0.03] px-3.5 py-2.5 text-sm outline-none transition focus:border-vault-accent/60"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="rounded-xl bg-gradient-to-br from-vault-accent to-vault-accent2 px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-40"
            >
              {sending ? '…' : 'Envoyer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Messages(): React.JSX.Element {
  const [data, setData] = useState<MessagesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [openConv, setOpenConv] = useState<Conversation | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setData(await window.api.getMessages())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const convs = data?.conversations ?? []
  const totalUnread = convs.reduce((n, c) => n + c.unread, 0)

  if (openConv)
    return (
      <Thread conv={openConv} onClose={() => setOpenConv(null)} onSent={() => void load()} />
    )

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            Messages
            {totalUnread > 0 && (
              <span className="ml-2 rounded-full bg-vault-accent px-2 py-0.5 align-middle text-xs font-bold text-white">
                {totalUnread}
              </span>
            )}
          </h1>
          <p className="mt-1 text-xs text-vault-muted">
            Tes conversations Steam et Xbox, réunies au même endroit.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-vault-border px-4 py-2 text-sm font-semibold transition hover:border-vault-accent/50 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : '↻ Actualiser'}
        </button>
      </div>

      {/* Notes par plateforme : toujours visibles, y compris quand tout est vide. */}
      <div className="mb-5 grid gap-2">
        <PlatformNote label="Xbox" connected={data?.xbox.connected ?? false} note={data?.xbox.note ?? null} />
        <PlatformNote label="Steam" connected={data?.steam.connected ?? false} note={data?.steam.note ?? null} />
      </div>

      {convs.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-3xl">
            💬
          </div>
          <p className="text-sm font-semibold">Aucune conversation pour le moment</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-vault-muted">
            Dès qu'un ami t'écrira sur Xbox, le fil apparaîtra ici. La page reste disponible même sans
            amis ni messages — elle se remplira toute seule.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {convs.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              onClick={() => setOpenConv(c)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setOpenConv(c)
              }}
              className="glass flex cursor-pointer items-center gap-3.5 rounded-2xl p-3.5 transition hover:border-vault-accent/40 hover:bg-white/[0.03]"
            >
              <Avatar c={c} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold">{c.name}</span>
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${BADGE[c.platform].cls}`}>
                    {BADGE[c.platform].label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-vault-muted">{c.lastMessage}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[10px] text-vault-muted">{relative(c.lastAt)}</span>
                {c.unread > 0 && (
                  <span className="rounded-full bg-vault-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {c.unread}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
