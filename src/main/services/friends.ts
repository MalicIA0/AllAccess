import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Friend, FriendsResult } from '../../shared/types'
import { getSteamAccess, isSteamConnected } from './steamAuth'
import { getXboxAccess, xboxApiHeaders } from './xboxAuth'
import { isXboxConnected } from './xboxAuth'

/**
 * Liste des amis Steam + Xbox, via les mêmes sessions/jetons que la bibliothèque.
 * Best-effort : si une plateforme échoue (session expirée, API indisponible), on renvoie
 * quand même les autres et on remonte l'erreur pour l'afficher discrètement.
 */

const STEAM_API = 'https://api.steampowered.com'

/* ------------------------------- Steam ------------------------------- */

// NB : on utilise la famille ISteamUserOAuth, qui accepte le webapi_token (access_token) de
// l'utilisateur — contrairement à ISteamUser/* qui exige une clé développeur (HTTP 400 sinon).
interface SteamFriendList {
  friends?: { steamid: string; relationship: string }[]
}
interface SteamPlayer {
  steamid: string
  personaname: string
  avatarfull?: string
  avatarmedium?: string
  avatar?: string
  personastate?: number // 0 hors ligne, 1 en ligne, 2 occupé, 3 absent, 4 assoupi, 5/6…
  gameextrainfo?: string // nom du jeu en cours
}
interface SteamSummaries {
  players?: SteamPlayer[]
}

const STEAM_STATE: Record<number, string> = {
  0: 'Hors ligne',
  1: 'En ligne',
  2: 'Occupé',
  3: 'Absent',
  4: 'Assoupi',
  5: 'Cherche à échanger',
  6: 'Cherche à jouer'
}

async function steamGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${STEAM_API}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Steam ${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

async function fetchSteamFriends(): Promise<Friend[]> {
  const { token, steamId64 } = await getSteamAccess()
  const list = await steamGet<SteamFriendList>('/ISteamUserOAuth/GetFriendList/v0001/', {
    access_token: token,
    steamid: steamId64,
    relationship: 'friend'
  })
  const ids = (list.friends ?? []).map((f) => f.steamid)
  if (ids.length === 0) return []

  // GetUserSummaries limite à 100 steamids par appel
  const players: SteamPlayer[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const sum = await steamGet<SteamSummaries>('/ISteamUserOAuth/GetUserSummaries/v0002/', {
      access_token: token,
      steamids: chunk.join(',')
    })
    players.push(...(sum.players ?? []))
  }

  return players.map((p) => {
    const online = (p.personastate ?? 0) !== 0
    const status = p.gameextrainfo ? `Joue à ${p.gameextrainfo}` : (STEAM_STATE[p.personastate ?? 0] ?? 'Hors ligne')
    return {
      id: `steam:${p.steamid}`,
      platform: 'steam' as const,
      name: p.personaname,
      avatarUrl: p.avatarfull ?? p.avatarmedium ?? p.avatar ?? null,
      online,
      status,
      game: p.gameextrainfo ?? null,
      sessionSince: null // renseigné par trackSessions() une fois la liste complète
    }
  })
}

/* ------------------------------- Xbox -------------------------------- */

interface XblPerson {
  xuid: string
  displayName?: string
  gamertag?: string
  modernGamertag?: string
  displayPicRaw?: string
  presenceState?: string // 'Online' | 'Offline'
  presenceText?: string // « En ligne », titre en cours…
}
interface XblPeople {
  people?: XblPerson[]
}

function toXboxFriend(p: XblPerson): Friend {
  const online = (p.presenceState ?? 'Offline') === 'Online'
  const presence = p.presenceText && p.presenceText !== 'Online' ? p.presenceText : online ? 'En ligne' : 'Hors ligne'
  // peoplehub renvoie souvent le jeu en cours dans presenceText (ex. « Halo Infinite »)
  const game = online && p.presenceText && p.presenceText !== 'Online' && p.presenceText !== 'Home' ? p.presenceText : null
  return {
    id: `xbox:${p.xuid}`,
    platform: 'xbox' as const,
    name: p.gamertag || p.modernGamertag || p.displayName || 'Joueur Xbox',
    avatarUrl: p.displayPicRaw ? p.displayPicRaw.replace('http://', 'https://') : null,
    online,
    status: presence,
    game,
    sessionSince: null // renseigné par trackSessions() une fois la liste complète
  }
}

/** Appel peoplehub décoré (détail + présence). `moniker` = 'social' (mes amis) ou 'people/xuids(...)'.
 *  `force` : re-mint le jeton XSTS avant l'appel (2ᵉ essai après un 401). */
async function peoplehub(moniker: string, force = false): Promise<XblPerson[]> {
  const auth = await getXboxAccess(force)
  const res = await fetch(
    `https://peoplehub.xboxlive.com/users/me/people/${moniker}/decoration/detail,preferredColor,presenceDetail`,
    {
      headers: { ...xboxApiHeaders(auth), 'x-xbl-contract-version': '5' },
      signal: AbortSignal.timeout(25_000)
    }
  )
  // 401 = jeton rejeté (souvent pile à l'expiration ~1h) : on re-mint un XSTS neuf et on réessaie une fois.
  if (res.status === 401 && !force) return peoplehub(moniker, true)
  if (!res.ok) {
    // On remonte le corps de la réponse : c'est LUI qui dit pourquoi (403 vie privée, jeton, etc.)
    const body = await res.text().catch(() => '')
    throw new Error(`peoplehub ${moniker} → HTTP ${res.status}${body ? ` — ${body.slice(0, 160)}` : ''}`)
  }
  return ((await res.json()) as XblPeople).people ?? []
}

async function fetchXboxFriends(): Promise<Friend[]> {
  // Méthode principale : peoplehub "social" = ma liste d'amis, déjà décorée (avatars + présence).
  let people = await peoplehub('social')

  // Filet de sécurité : si "social" ne renvoie rien (certains comptes ne remplissent cette vue
  // qu'après coup), on récupère la liste d'amis BRUTE via social.xboxlive.com, puis on la décore.
  if (people.length === 0) {
    const ids = await fetchXboxFriendXuids()
    if (ids.length > 0) {
      // peoplehub accepte jusqu'à ~30 xuids par appel dans people/xuids(...)
      for (let i = 0; i < ids.length; i += 30) {
        people.push(...(await peoplehub(`xuids(${ids.slice(i, i + 30).join(',')})`)))
      }
    }
  }

  return people.map(toXboxFriend)
}

/** Liste d'amis brute (juste les XUID) via l'API sociale — utilisée en secours quand peoplehub est vide. */
async function fetchXboxFriendXuids(): Promise<string[]> {
  const auth = await getXboxAccess()
  const res = await fetch('https://social.xboxlive.com/users/me/people', {
    headers: xboxApiHeaders(auth), // contract-version 2 (défaut) : correct pour social.xboxlive.com
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`social.xboxlive → HTTP ${res.status}`)
  const body = (await res.json()) as { people?: { xuid: string }[] }
  return (body.people ?? []).map((p) => p.xuid)
}

/* ------------------------------ Combiné ------------------------------ */

/* --------------------- Suivi des sessions de jeu ---------------------- */

/**
 * Ni Steam ni Xbox n'exposent l'heure à laquelle un ami a lancé sa partie : on l'estime en
 * notant le premier instant où on le voit sur un jeu donné, et on garde cette date tant qu'il
 * y reste. Le suivi vit ICI (processus principal) et non dans la page Amis : il tourne donc
 * dès le lancement de l'appli, y compris quand l'utilisateur est sur un autre onglet. Avant,
 * le chrono repartait de zéro à chaque ouverture de la page — d'où l'éternel « depuis 1 min ».
 */
interface TrackedSession {
  game: string
  since: number
}

const SESSIONS_FILE = 'friend-sessions.json'
let sessionCache: Record<string, TrackedSession> | null = null

function sessionsPath(): string {
  return join(app.getPath('userData'), SESSIONS_FILE)
}

function loadSessions(): Record<string, TrackedSession> {
  if (sessionCache) return sessionCache
  try {
    sessionCache = JSON.parse(readFileSync(sessionsPath(), 'utf-8')) as Record<string, TrackedSession>
  } catch {
    sessionCache = {}
  }
  return sessionCache
}

function saveSessions(s: Record<string, TrackedSession>): void {
  sessionCache = s
  try {
    writeFileSync(sessionsPath(), JSON.stringify(s), 'utf-8')
  } catch {
    /* disque plein / droits : le suivi reste valable en mémoire pour cette session */
  }
}

/** Renseigne `sessionSince` sur chaque ami en jeu, en conservant les débuts déjà connus. */
function trackSessions(friends: Friend[]): void {
  const prev = loadSessions()
  const next: Record<string, TrackedSession> = {}
  const now = Date.now()
  for (const f of friends) {
    if (!f.online || !f.game) continue
    const existing = prev[f.id]
    // même joueur + même jeu qu'au tour précédent → on garde l'heure de début d'origine
    const entry = existing && existing.game === f.game ? existing : { game: f.game, since: now }
    next[f.id] = entry
    f.sessionSince = entry.since
  }
  saveSessions(next)
}

export async function fetchFriends(): Promise<FriendsResult> {
  const errors: string[] = []
  const friends: Friend[] = []

  if (isSteamConnected().connected) {
    try {
      friends.push(...(await fetchSteamFriends()))
    } catch (e) {
      errors.push(`Steam : ${(e as Error).message}`)
    }
  }
  if (isXboxConnected().connected) {
    try {
      friends.push(...(await fetchXboxFriends()))
    } catch (e) {
      errors.push(`Xbox : ${(e as Error).message}`)
    }
  }

  // Chronomètres de session : mis à jour à CHAQUE appel, y compris ceux du compteur de la
  // barre latérale — le suivi avance donc même si la page Amis n'est jamais ouverte.
  trackSessions(friends)

  // en ligne d'abord, puis par nom
  friends.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { friends, errors }
}
