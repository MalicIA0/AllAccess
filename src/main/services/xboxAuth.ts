import { BrowserWindow, session } from 'electron'
import { getAuth, saveAuth, type XboxAuth } from './authStore'

/**
 * Connexion Xbox sans clé API : OAuth Microsoft (client public "Xbox") en **flux code**
 * (response_type=code) pour obtenir un **refresh_token** longue durée → reconnexion
 * silencieuse pendant des semaines, sans jamais redemander le login. On échange ensuite
 * le jeton Microsoft façon Xbox Live : RPS ticket → User Token → XSTS Token, puis on parle
 * directement aux endpoints officiels titlehub / achievements.xboxlive.com.
 */

const PARTITION = 'persist:xbox'
const CLIENT_ID = '000000004C12AE6F' // client public Xbox (login.live.com)
const REDIRECT = 'https://login.live.com/oauth20_desktop.srf'
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL'
const TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const AUTH_URL =
  `https://login.live.com/oauth20_authorize.srf?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&response_type=code&display=touch&locale=fr` +
  `&scope=${encodeURIComponent(SCOPE)}`

export class NeedsXboxLogin extends Error {
  constructor() {
    super('Connexion Xbox requise — clique sur « Se connecter à Xbox » dans les Réglages.')
  }
}

/* ---------------- OAuth Microsoft (code + refresh) ---------------- */

interface MsTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** POST vers le endpoint de jeton MSA (client public, pas de secret). */
async function tokenRequest(extra: Record<string, string>): Promise<MsTokens> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: SCOPE,
      ...extra
    }).toString(),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`oauth20_token → HTTP ${res.status}`)
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!j.access_token) throw new Error('Réponse de jeton Microsoft invalide.')
  return { accessToken: j.access_token, refreshToken: j.refresh_token ?? '', expiresIn: j.expires_in ?? 3600 }
}

const exchangeCode = (code: string): Promise<MsTokens> => tokenRequest({ code, grant_type: 'authorization_code' })
const refreshMsTokens = (refreshToken: string): Promise<MsTokens> =>
  tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' })

/** Fenêtre de connexion visible → récupère le `code` d'autorisation depuis la redirection. */
function loginWindow(parent: BrowserWindow | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      show: true,
      parent: parent ?? undefined,
      title: 'Connexion Xbox — compte Microsoft',
      autoHideMenuBar: true,
      backgroundColor: '#0e0e0e',
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true }
    })
    let settled = false
    const tryUrl = (url: string): void => {
      if (settled || !url.startsWith(REDIRECT)) return
      const q = new URLSearchParams(url.split('?')[1] ?? '')
      const code = q.get('code')
      const err = q.get('error')
      if (code) {
        settled = true
        win.destroy()
        resolve(code)
      } else if (err) {
        settled = true
        win.destroy()
        reject(new Error(`Connexion Xbox refusée : ${err}`))
      }
    }
    win.webContents.on('will-redirect', (_e, url) => tryUrl(url))
    win.webContents.on('did-navigate', (_e, url) => tryUrl(url))
    win.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('Fenêtre fermée avant la fin de la connexion Xbox.'))
      }
    })
    void win.loadURL(AUTH_URL)
  })
}

/* ---------------- Échange Microsoft → Xbox Live (XSTS) ---------------- */

interface XasuResponse {
  Token: string
  DisplayClaims?: { xui?: { uhs: string }[] }
}
interface XstsResponse {
  Token: string
  NotAfter: string
  DisplayClaims: { xui: { uhs: string; xid?: string; gtg?: string }[] }
}

async function postJson<T>(url: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/** RPS ticket → User token. Selon le type de compte, le préfixe attendu varie — on tente les formes connues. */
async function mintUserToken(msToken: string): Promise<string> {
  for (const rps of [`d=${msToken}`, `t=${msToken}`, msToken]) {
    try {
      const user = await postJson<XasuResponse>('https://user.auth.xboxlive.com/user/authenticate', {
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: rps },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      })
      return user.Token
    } catch {
      /* forme suivante */
    }
  }
  throw new Error("Échec de l'authentification Xbox Live (user token).")
}

/** msToken (RPS) → User token → XSTS token (+ identité). Renvoie l'auth SANS le refresh (ajouté par l'appelant). */
async function exchangeMsToken(msToken: string, msExp: number): Promise<Omit<XboxAuth, 'refreshToken' | 'refreshExp'>> {
  const userToken = await mintUserToken(msToken)
  const xsts = await postJson<XstsResponse>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    RelyingParty: 'http://xboxlive.com',
    TokenType: 'JWT'
  })
  const xui = xsts.DisplayClaims.xui[0]
  return {
    msToken,
    msExp,
    xstsToken: xsts.Token,
    xstsExp: Date.parse(xsts.NotAfter),
    uhs: xui.uhs,
    xuid: xui.xid ?? '',
    gamertag: xui.gtg ?? ''
  }
}

/** Construit une auth complète (avec refresh) à partir des jetons Microsoft fraîchement obtenus. */
async function buildAuth(t: MsTokens, fallbackRefresh?: string): Promise<XboxAuth> {
  const base = await exchangeMsToken(t.accessToken, Date.now() + t.expiresIn * 1000)
  return {
    ...base,
    // les jetons de rafraîchissement MSA sont longue durée (roulés à chaque usage) — 45 j d'estimation
    refreshToken: t.refreshToken || fallbackRefresh || '',
    refreshExp: Date.now() + 45 * 86400_000
  }
}

/**
 * Garantit une session avec un `msToken` frais : rafraîchit en SILENCE via le refresh_token
 * (simple appel HTTP, aucune fenêtre) si le jeton Microsoft a expiré.
 */
async function ensureFreshMs(force = false): Promise<XboxAuth> {
  const stored = getAuth().xbox
  if (!stored) throw new NeedsXboxLogin()
  if (!force && stored.msExp - Date.now() > 60_000) return stored
  if (stored.refreshToken) {
    const t = await refreshMsTokens(stored.refreshToken)
    const fresh = await buildAuth(t, stored.refreshToken)
    saveAuth({ xbox: fresh })
    return fresh
  }
  // vieille session sans refresh_token → reconnexion manuelle requise (une seule fois)
  throw new NeedsXboxLogin()
}

/**
 * Auth XSTS valide pour Xbox Live — rafraîchie silencieusement via refresh_token si besoin.
 * `force` : ignore le cache et re-mint un XSTS neuf, même si l'ancien n'est pas encore « expiré »
 * selon notre horloge (utile quand Xbox rejette quand même le jeton — 401 pile à l'expiration).
 */
export async function getXboxAccess(force = false): Promise<XboxAuth> {
  const stored = getAuth().xbox
  if (!force && stored && stored.xstsExp - Date.now() > 5 * 60_000) return stored
  const fresh = await ensureFreshMs(force)
  const xsts = await exchangeMsToken(fresh.msToken, fresh.msExp)
  const merged: XboxAuth = { ...xsts, refreshToken: fresh.refreshToken, refreshExp: fresh.refreshExp }
  saveAuth({ xbox: merged })
  return merged
}

let storeXsts: { token: string; uhs: string; exp: number } | null = null

/**
 * Jeton XSTS pour les API du Microsoft Store (collections.mp.microsoft.com) —
 * même flux que Xbox Live mais avec le RelyingParty du Store.
 */
export async function getStoreAccess(): Promise<{ token: string; uhs: string }> {
  if (storeXsts && storeXsts.exp - Date.now() > 5 * 60_000) return storeXsts
  const fresh = await ensureFreshMs()
  const userToken = await mintUserToken(fresh.msToken)
  const xsts = await postJson<XstsResponse>('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] },
    RelyingParty: 'http://mp.microsoft.com/',
    TokenType: 'JWT'
  })
  storeXsts = {
    token: xsts.Token,
    uhs: xsts.DisplayClaims.xui[0].uhs,
    exp: Date.parse(xsts.NotAfter)
  }
  return storeXsts
}

export function isXboxConnected(): { connected: boolean; gamertag?: string } {
  const x = getAuth().xbox
  // Sans refresh_token la session est morte (impossible à rafraîchir) : mieux vaut la traiter
  // comme déconnectée pour que les Réglages réaffichent « Se connecter » au lieu d'un « Connecté »
  // trompeur qui ne propose plus que « Déconnecter ».
  return x?.refreshToken ? { connected: true, gamertag: x.gamertag } : { connected: false }
}

export function xboxLogout(): void {
  saveAuth({ xbox: undefined })
  void session.fromPartition(PARTITION).clearStorageData()
}

/**
 * Connexion Xbox : tente d'abord une reconnexion SILENCIEUSE via le refresh_token stocké
 * (aucune fenêtre, aucun mot de passe) ; n'ouvre la fenêtre de connexion que si le refresh
 * a échoué ou n'existe pas. Après une connexion réussie, l'appli reste connectée des semaines.
 */
export async function xboxLogin(parent: BrowserWindow | null): Promise<{ gamertag: string }> {
  const stored = getAuth().xbox
  if (stored?.refreshToken) {
    try {
      const t = await refreshMsTokens(stored.refreshToken)
      const fresh = await buildAuth(t, stored.refreshToken)
      saveAuth({ xbox: fresh })
      return { gamertag: fresh.gamertag }
    } catch {
      /* refresh_token mort → connexion visible */
    }
  }
  const code = await loginWindow(parent)
  const tokens = await exchangeCode(code)
  const fresh = await buildAuth(tokens)
  saveAuth({ xbox: fresh })
  return { gamertag: fresh.gamertag }
}

export function xboxApiHeaders(a: XboxAuth): Record<string, string> {
  return {
    Authorization: `XBL3.0 x=${a.uhs};${a.xstsToken}`,
    'x-xbl-contract-version': '2',
    Accept: 'application/json',
    'Accept-Language': 'fr-FR'
  }
}
