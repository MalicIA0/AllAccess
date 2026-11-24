import { BrowserWindow, session } from 'electron'
import { getAuth, saveAuth } from './authStore'

/**
 * Connexion Steam sans clé API :
 * l'utilisateur se connecte sur la vraie page steamcommunity.com dans une fenêtre dédiée
 * (session persistante `persist:steam`), puis on récupère le webapi_token que Steam
 * fournit à ses propres pages. Ce jeton donne accès aux endpoints officiels
 * api.steampowered.com pour SON propre compte (profil privé inclus).
 */

const PARTITION = 'persist:steam'
const TOKEN_URL = 'https://steamcommunity.com/pointssummary/ajaxgetasyncconfig'

export class NeedsSteamLogin extends Error {
  constructor() {
    super('Connexion Steam requise — clique sur « Se connecter à Steam » dans les Réglages.')
  }
}

function decodeJwt(token: string): { exp?: number; sub?: string } {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf-8'))
  } catch {
    return {}
  }
}

type TokenResult =
  | { ok: true; token: string; steamId64: string; exp: number }
  | { ok: false; reason: 'logged_out' | 'network' }

/**
 * Tente de récupérer un webapi_token frais depuis la session persistée (cookies).
 * Distingue « Steam répond : pas de session » (logged_out) d'un simple incident
 * réseau/timeout (network) — seul le premier justifie de jeter la connexion stockée.
 * Timeout indispensable : ce fetch est le tout premier appel de la sync Steam ; sans lui,
 * une requête pendue bloquait le verrou `syncing` pour toujours (vu le 21/07).
 */
async function fetchWebApiToken(): Promise<TokenResult> {
  const ses = session.fromPartition(PARTITION)
  // deux domaines : la connexion Steam pose les cookies sur les deux, si l'un est HS l'autre répond
  for (const url of [TOKEN_URL, 'https://store.steampowered.com/pointssummary/ajaxgetasyncconfig']) {
    try {
      const res = await ses.fetch(url, { credentials: 'include', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) continue // 5xx/403 ponctuel → essaie l'autre domaine
      const body = (await res.json()) as { success?: number; data?: { webapi_token?: string } }
      const token = body?.data?.webapi_token
      if (!token) return { ok: false, reason: 'logged_out' } // réponse claire : cookies morts
      const payload = decodeJwt(token)
      if (!payload.sub) return { ok: false, reason: 'logged_out' }
      return { ok: true, token, steamId64: payload.sub, exp: (payload.exp ?? 0) * 1000 }
    } catch {
      /* réseau/timeout → essaie l'autre domaine */
    }
  }
  return { ok: false, reason: 'network' }
}

/** Jeton valide, rafraîchi en silence via les cookies si besoin. */
export async function getSteamAccess(): Promise<{ token: string; steamId64: string }> {
  const stored = getAuth().steam
  if (stored && stored.exp - Date.now() > 5 * 60_000) return { token: stored.token, steamId64: stored.steamId64 }
  const fresh = await fetchWebApiToken()
  if (fresh.ok) {
    saveAuth({ steam: { steamId64: fresh.steamId64, token: fresh.token, exp: fresh.exp } })
    return { token: fresh.token, steamId64: fresh.steamId64 }
  }
  if (fresh.reason === 'logged_out') {
    // Steam a répondu « pas de session » : la déconnexion est réelle, on l'acte.
    saveAuth({ steam: undefined })
    throw new NeedsSteamLogin()
  }
  // Incident réseau/timeout : on GARDE la connexion stockée — pas de déconnexion sur un
  // simple passage à vide, la prochaine sync retentera.
  throw new Error('Steam injoignable pour le moment — nouvelle tentative à la prochaine synchronisation.')
}

/**
 * Ensemble des appids possédés (jeux ET DLC) via le Store, en réutilisant les cookies
 * de session persistés. Sert à savoir quels DLC l'utilisateur possède réellement.
 * Retourne un ensemble vide si la session Store n'est pas disponible (best-effort).
 */
export async function fetchSteamOwnedAppIds(): Promise<Set<number>> {
  try {
    const ses = session.fromPartition(PARTITION)
    const res = await ses.fetch('https://store.steampowered.com/dynamicstore/userdata/', {
      credentials: 'include',
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return new Set()
    const body = (await res.json()) as { rgOwnedApps?: number[] }
    return new Set(body.rgOwnedApps ?? [])
  } catch {
    return new Set()
  }
}

export function isSteamConnected(): { connected: boolean; steamId64?: string } {
  const s = getAuth().steam
  return s ? { connected: true, steamId64: s.steamId64 } : { connected: false }
}

/**
 * Vérifie que la session Steam est RÉELLEMENT active — c.-à-d. que les cookies de session
 * fonctionnent encore, pas seulement qu'un jeton est stocké. C'est la différence qui piège :
 * un jeton peut sembler valide alors que les cookies (nécessaires aux pages communautaires de
 * succès) sont morts → l'appli croit être « connectée » mais récupère des données déconnectées.
 * Rafraîchit le jeton au passage si les cookies répondent encore.
 */
export async function verifySteamSession(): Promise<boolean> {
  if (!getAuth().steam) return false
  const fresh = await fetchWebApiToken()
  if (fresh.ok) {
    saveAuth({ steam: { steamId64: fresh.steamId64, token: fresh.token, exp: fresh.exp } })
    return true
  }
  // incident réseau : bénéfice du doute — pas d'avertissement « session expirée » à tort
  return fresh.reason === 'network'
}

export function steamLogout(): void {
  saveAuth({ steam: undefined })
  void session.fromPartition(PARTITION).clearStorageData()
}

/** Ouvre la fenêtre de connexion officielle Steam et attend que la session soit active. */
export async function steamLogin(parent: BrowserWindow | null): Promise<{ steamId64: string }> {
  // Déjà connecté via cookies ? Pas besoin de fenêtre.
  const silent = await fetchWebApiToken()
  if (silent.ok) {
    saveAuth({ steam: { steamId64: silent.steamId64, token: silent.token, exp: silent.exp } })
    return { steamId64: silent.steamId64 }
  }

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent ?? undefined,
      modal: false,
      title: 'Connexion Steam',
      autoHideMenuBar: true,
      backgroundColor: '#171a21',
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true }
    })
    let settled = false
    let poll: NodeJS.Timeout | null = null

    const finish = async (): Promise<void> => {
      if (settled) return
      const t = await fetchWebApiToken()
      if (!t.ok) return
      settled = true
      if (poll) clearInterval(poll)
      saveAuth({ steam: { steamId64: t.steamId64, token: t.token, exp: t.exp } })
      if (!win.isDestroyed()) win.close()
      resolve({ steamId64: t.steamId64 })
    }

    win.webContents.on('did-navigate', () => void finish())
    poll = setInterval(() => void finish(), 2_500)
    win.on('closed', () => {
      if (poll) clearInterval(poll)
      if (!settled) reject(new Error('Fenêtre fermée avant la fin de la connexion Steam.'))
    })
    void win.loadURL('https://steamcommunity.com/login/home/')
  })
}
