import type {
  Conversation,
  ConversationThread,
  MessagesPlatformState,
  MessagesResult,
  ThreadMessage
} from '../../shared/types'
import { getSteamAccess, isSteamConnected } from './steamAuth'
import { getXboxAccess, isXboxConnected, xboxApiHeaders } from './xboxAuth'
import { alog } from './achievementLog'

/**
 * Messages Steam + Xbox, sur le modèle de `friends.ts` : best-effort, une plateforme qui
 * échoue n'empêche pas l'autre de s'afficher, et chaque plateforme remonte une note lisible
 * expliquant une liste vide (non connecté, boîte vide, API indisponible).
 */

/* -------------------------------- Xbox -------------------------------- */

// API de messagerie Xbox Live (même jeton XSTS que le reste). Contrat 1 pour /inbox.
const XBL_MESSAGING = 'https://xblmessaging.xboxlive.com'

interface XblConversation {
  conversationId?: string
  timestamp?: string
  /** Les DEUX participants du fil, y compris soi-même → il faut filtrer son propre XUID. */
  participants?: string[]
  isRead?: boolean
  lastMessage?: {
    contentPayload?: { content?: { parts?: { text?: string }[] } }
    timestamp?: string
    sender?: string
  }
}
/**
 * Forme réelle de la réponse `/inbox` (vérifiée sur un compte réel) : les fils sont rangés
 * sous `primary.conversations`, PAS à la racine. Les lire à la racine renvoyait toujours une
 * liste vide — d'où le « aucun message » alors que la boîte en contenait quatre.
 */
interface XblInbox {
  primary?: { conversations?: XblConversation[]; unreadCount?: number }
}

/** Extrait le texte lisible d'un message Xbox (le contenu est découpé en « parts »). */
function xblText(c: XblConversation): string {
  const parts = c.lastMessage?.contentPayload?.content?.parts ?? []
  const txt = parts
    .map((p) => p.text ?? '')
    .join(' ')
    .trim()
  return txt || '(pièce jointe ou message sans texte)'
}

async function fetchXboxConversations(): Promise<Conversation[]> {
  const auth = await getXboxAccess()
  const res = await fetch(`${XBL_MESSAGING}/network/Xbox/users/me/inbox`, {
    headers: { ...xboxApiHeaders(auth), 'x-xbl-contract-version': '1' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`Xbox messagerie → HTTP ${res.status}`)
  const body = (await res.json()) as XblInbox

  const convs = body.primary?.conversations ?? []
  const me = auth.xuid
  // L'interlocuteur = le participant qui n'est pas soi. Sans ce filtre, un fil pouvait
  // s'afficher à son propre nom (les deux XUID sont présents dans `participants`).
  const otherOf = (c: XblConversation): string => (c.participants ?? []).find((p) => p !== me) ?? ''

  // Les participants sont des XUID : on résout tous les gamertags en une seule requête.
  const names = await resolveGamertags(auth, [...new Set(convs.map(otherOf).filter(Boolean))])

  return convs.map((c) => {
    const other = otherOf(c)
    const profile = names.get(other)
    const at = c.lastMessage?.timestamp ?? c.timestamp
    return {
      id: c.conversationId ?? other,
      peerId: other,
      platform: 'xbox' as const,
      name: profile?.gamertag || other || 'Inconnu',
      avatarUrl: profile?.avatar ?? null,
      lastMessage: xblText(c),
      lastAt: at ? new Date(at).getTime() : null,
      // pas de compteur par fil dans l'API : `isRead` false = au moins un message non lu
      unread: c.isRead === false ? 1 : 0
    }
  })
}

interface XblProfileResponse {
  profileUsers?: { id: string; settings?: { id: string; value: string }[] }[]
}

/** Gamertag + avatar pour une liste de XUID (une seule requête). */
async function resolveGamertags(
  auth: Awaited<ReturnType<typeof getXboxAccess>>,
  xuids: string[]
): Promise<Map<string, { gamertag: string; avatar: string | null }>> {
  const out = new Map<string, { gamertag: string; avatar: string | null }>()
  if (xuids.length === 0) return out
  try {
    const res = await fetch('https://profile.xboxlive.com/users/batch/profile/settings', {
      method: 'POST',
      headers: { ...xboxApiHeaders(auth), 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: xuids, settings: ['Gamertag', 'GameDisplayPicRaw'] }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return out
    const body = (await res.json()) as XblProfileResponse
    for (const u of body.profileUsers ?? []) {
      const get = (k: string): string | undefined => u.settings?.find((s) => s.id === k)?.value
      out.set(u.id, { gamertag: get('Gamertag') ?? u.id, avatar: get('GameDisplayPicRaw') ?? null })
    }
  } catch {
    /* pas de gamertag → on retombera sur le XUID brut */
  }
  return out
}

/* ------------------- Fil de discussion + réponse (Xbox) ------------------- */

interface XblThreadResponse {
  participants?: string[]
  messages?: {
    messageId?: string
    sender?: string
    timestamp?: string
    type?: string
    contentPayload?: { content?: { parts?: { text?: string }[] } }
  }[]
}

/** Historique complet d'un fil avec un ami Xbox, trié du plus ancien au plus récent. */
export async function fetchXboxThread(peerXuid: string): Promise<ConversationThread> {
  const auth = await getXboxAccess()
  const me = auth.xuid
  try {
    const res = await fetch(
      `${XBL_MESSAGING}/network/Xbox/users/me/conversations/users/xuid(${peerXuid})?maxItems=100`,
      { headers: { ...xboxApiHeaders(auth), 'x-xbl-contract-version': '1' }, signal: AbortSignal.timeout(20_000) }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as XblThreadResponse

    const names = await resolveGamertags(auth, [peerXuid])
    const messages: ThreadMessage[] = (body.messages ?? [])
      .filter((m) => m.type !== 'SystemMessage')
      .map((m, i) => ({
        id: m.messageId ?? `m${i}`,
        mine: m.sender === me,
        text: (m.contentPayload?.content?.parts ?? [])
          .map((p) => p.text ?? '')
          .join(' ')
          .trim(),
        at: m.timestamp ? new Date(m.timestamp).getTime() : null
      }))
      .filter((m) => m.text.length > 0)
      // l'API ne garantit pas l'ordre : on trie nous-mêmes, plus ancien en haut
      .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))

    return { peerId: peerXuid, name: names.get(peerXuid)?.gamertag ?? peerXuid, messages, error: null }
  } catch (e) {
    return { peerId: peerXuid, name: peerXuid, messages: [], error: (e as Error).message }
  }
}

/**
 * Envoie un message à un ami Xbox. Déclenché UNIQUEMENT par un clic explicite de
 * l'utilisateur sur « Envoyer » dans la page Messages.
 */
export async function sendXboxMessage(
  peerXuid: string,
  text: string
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const body = text.trim()
  if (!body) return { ok: false, error: 'Message vide.' }
  try {
    const auth = await getXboxAccess()
    const res = await fetch(`${XBL_MESSAGING}/network/Xbox/users/me/conversations/users/xuid(${peerXuid})`, {
      method: 'POST',
      headers: { ...xboxApiHeaders(auth), 'x-xbl-contract-version': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ contentType: 'text', version: 0, text: body }] }),
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) {
      // Le détail renvoyé par Xbox est indispensable au diagnostic : un simple code HTTP ne
      // dit pas si c'est le format du corps, le contrat d'API ou une restriction du compte.
      const detail = await res.text().catch(() => '')
      alog(`envoi message Xbox refuse (HTTP ${res.status}) : ${detail.slice(0, 300)}`)
      return { ok: false, error: `Xbox a refusé l'envoi (HTTP ${res.status}). ${detail.slice(0, 200)}` }
    }
    // L'identifiant renvoyé permet d'afficher le message tout de suite sans attendre que
    // Xbox le publie dans l'historique (quelques secondes de décalage), puis de dédoublonner
    // quand le fil se recharge vraiment.
    const sent = (await res.json().catch(() => ({}))) as { messageId?: string }
    alog(`message Xbox envoye a ${peerXuid} (${body.length} caracteres)`)
    return { ok: true, messageId: sent.messageId }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* -------------------------------- Steam -------------------------------- */

interface SteamSessionsResponse {
  response?: {
    message_sessions?: { accountid_friend?: number; last_message?: number; unread_message_count?: number }[]
  }
}

/**
 * Steam n'expose PAS de véritable API de lecture du chat : le client officiel passe par le
 * protocole Steam Network (WebSocket + protobuf), inaccessible à une appli tierce. Le seul
 * point d'entrée Web est `GetActiveMessageSessions`, qui liste les conversations récentes
 * (interlocuteur + horodatage + non-lus) mais JAMAIS le texte des messages.
 */
async function fetchSteamConversations(): Promise<Conversation[]> {
  const { token } = await getSteamAccess()
  const url = new URL('https://api.steampowered.com/IFriendMessagesService/GetActiveMessageSessions/v1/')
  url.searchParams.set('access_token', token)
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Steam messagerie → HTTP ${res.status}`)
  const body = (await res.json()) as SteamSessionsResponse
  const sessions = body.response?.message_sessions ?? []

  return sessions.map((s) => {
    // accountid (32 bits) → steamID64
    const steamId64 = s.accountid_friend != null ? (BigInt(s.accountid_friend) + 76561197960265728n).toString() : ''
    return {
      id: `steam:${steamId64}`,
      peerId: steamId64,
      platform: 'steam' as const,
      name: steamId64 || 'Ami Steam',
      avatarUrl: null,
      lastMessage: 'Conversation Steam — le texte des messages n’est pas accessible hors du client Steam.',
      lastAt: s.last_message ? s.last_message * 1000 : null,
      unread: s.unread_message_count ?? 0
    }
  })
}

/* ------------------------------- Agrégat ------------------------------- */

export async function fetchMessages(): Promise<MessagesResult> {
  const steamOn = isSteamConnected().connected
  const xboxOn = isXboxConnected().connected

  const steam: MessagesPlatformState = { connected: steamOn, note: null }
  const xbox: MessagesPlatformState = { connected: xboxOn, note: null }
  const conversations: Conversation[] = []

  const tasks: Promise<void>[] = []

  if (!xboxOn) {
    xbox.note = 'Compte Xbox non connecté — connecte-le dans Réglages pour voir tes messages.'
  } else {
    tasks.push(
      fetchXboxConversations()
        .then((c) => {
          conversations.push(...c)
          if (c.length === 0) xbox.note = 'Aucun message dans ta boîte de réception Xbox.'
        })
        .catch((e: Error) => {
          xbox.note = `Messagerie Xbox indisponible (${e.message}).`
        })
    )
  }

  if (!steamOn) {
    steam.note = 'Compte Steam non connecté — connecte-le dans Réglages pour voir tes conversations.'
  } else {
    tasks.push(
      fetchSteamConversations()
        .then((c) => {
          conversations.push(...c)
          steam.note =
            c.length === 0
              ? 'Aucune conversation Steam récente.'
              : 'Steam ne permet pas de lire le texte des messages hors de son client : seules les conversations sont listées.'
        })
        .catch((e: Error) => {
          steam.note = `Conversations Steam indisponibles (${e.message}).`
        })
    )
  }

  await Promise.all(tasks)
  // plus récent d'abord ; les fils sans date passent en fin de liste
  conversations.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  return { conversations, steam, xbox }
}
