import { BrowserWindow, session } from 'electron'
import { getAuth, saveAuth, type EpicAuth } from './authStore'

/**
 * Connexion Epic Games sans clé API ni mot de passe vu par All Access.
 * On réutilise le flux officiel du launcher Epic (mêmes identifiants publics que
 * l'application Epic Games Launcher) : l'utilisateur se connecte sur la vraie page
 * epicgames.com, puis Epic nous délivre un `authorizationCode` à usage unique via
 * l'endpoint /id/api/redirect. On l'échange contre des jetons (access + refresh),
 * chiffrés sur ce PC (DPAPI). All Access ne voit jamais le mot de passe.
 */

const PARTITION = 'persist:epic'
// Identifiants publics du client "Epic Games Launcher" (comme Legendary/Heroic)
const CLIENT_ID = '34a02cf8f4414e29b15921876da36f9a'
const CLIENT_SECRET = 'daafbccc737745039dffe53d94fc76cf'
const BASIC = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

const LOGIN_URL = 'https://www.epicgames.com/id/login'
const REDIRECT_URL = `https://www.epicgames.com/id/api/redirect?clientId=${CLIENT_ID}&responseType=code`
const TOKEN_URL = 'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token'

export class NeedsEpicLogin extends Error {
  constructor() {
    super('Connexion Epic requise — clique sur « Se connecter à Epic » dans les Réglages.')
  }
}

interface TokenResponse {
  access_token: string
  expires_at: string
  refresh_token: string
  refresh_expires_at: string
  account_id: string
  displayName?: string
}

function toEpicAuth(t: TokenResponse): EpicAuth {
  return {
    accessToken: t.access_token,
    accessExp: Date.parse(t.expires_at),
    refreshToken: t.refresh_token,
    refreshExp: Date.parse(t.refresh_expires_at),
    accountId: t.account_id,
    displayName: t.displayName ?? ''
  }
}

/**
 * Erreur d'échange de jeton Epic. `fatal = true` signifie que le jeton est réellement mort/révoqué
 * (Epic répond invalid_grant / invalid_client, HTTP 400/401) → il FAUT une reconnexion manuelle.
 * `fatal = false` = souci passager (réseau coupé, timeout, 5xx serveur) → NE PAS effacer la session,
 * on réessaiera au prochain lancement.
 */
class EpicExchangeError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean
  ) {
    super(message)
  }
}

async function exchange(body: Record<string, string>): Promise<EpicAuth> {
  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: BASIC, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (e) {
    // fetch lui-même a échoué (DNS, hors ligne, timeout) → jamais fatal, on réessaiera
    throw new EpicExchangeError(`Epic oauth/token injoignable : ${(e as Error).message}`, false)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Seul un vrai rejet du jeton (400/401 invalid_grant/invalid_client) est fatal.
    // Un 5xx ou un 429 côté Epic est passager → on garde la session.
    const fatal = (res.status === 400 || res.status === 401) && /invalid_grant|invalid_client|invalid_token/i.test(text)
    throw new EpicExchangeError(`Epic oauth/token → HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`, fatal)
  }
  return toEpicAuth((await res.json()) as TokenResponse)
}

/** Jeton d'accès valide, rafraîchi en silence via le refresh_token si besoin. */
export async function getEpicAccess(): Promise<{ token: string; accountId: string }> {
  const stored = getAuth().epic
  if (!stored) throw new NeedsEpicLogin()
  if (stored.accessExp - Date.now() > 5 * 60_000) {
    return { token: stored.accessToken, accountId: stored.accountId }
  }

  // On distingue deux mondes : un échec « fatal » (jeton révoqué → reconnexion manuelle) et un
  // échec « passager » (réseau/serveur → on garde la session et on réessaiera au prochain lancement).
  // Tant qu'on n'a pas la PREUVE que la session est morte, on n'efface JAMAIS `epic` : c'est ce qui
  // empêchait la reconnexion automatique (un simple hoquet réseau au démarrage effaçait le compte).
  let sawFatal = false

  // access expiré → on tente le refresh_token
  if (stored.refreshExp - Date.now() > 60_000) {
    try {
      const fresh = await exchange({ grant_type: 'refresh_token', refresh_token: stored.refreshToken, token_type: 'eg1' })
      // Epic ne renvoie pas toujours le displayName au refresh — on garde l'ancien
      if (!fresh.displayName) fresh.displayName = stored.displayName
      saveAuth({ epic: fresh })
      return { token: fresh.accessToken, accountId: fresh.accountId }
    } catch (e) {
      if (e instanceof EpicExchangeError && e.fatal) sawFatal = true
      else console.warn('[epic] refresh_token passager, on garde la session :', (e as Error).message)
      /* on tente la reconnexion silencieuse par cookies ci-dessous */
    }
  }

  // Dernier recours SILENCIEUX (comme Steam) : la session Epic persistée garde ses cookies
  // longtemps → on redemande un authorizationCode à usage unique sans fenêtre ni mot de passe,
  // et on l'échange contre des jetons frais. Tant que les cookies vivent, Epic se reconnecte seul.
  const code = await fetchAuthorizationCode()
  if (code) {
    try {
      const fresh = await exchange({ grant_type: 'authorization_code', code, token_type: 'eg1' })
      if (!fresh.displayName) fresh.displayName = stored.displayName
      saveAuth({ epic: fresh })
      return { token: fresh.accessToken, accountId: fresh.accountId }
    } catch (e) {
      if (e instanceof EpicExchangeError && e.fatal) sawFatal = true
      else console.warn('[epic] reconnexion cookies passagère, on garde la session :', (e as Error).message)
      /* cookies morts → reconnexion manuelle requise */
    }
  }

  // On n'efface la session QUE si Epic a explicitement rejeté nos jetons (révocation, mot de passe
  // changé…). Sinon (réseau coupé, serveur Epic KO), on lève une erreur SANS effacer : la connexion
  // reste "connectée" et la prochaine sync retentera automatiquement.
  if (sawFatal) {
    saveAuth({ epic: undefined })
    throw new NeedsEpicLogin()
  }
  throw new Error('Epic momentanément injoignable — réessai automatique au prochain rafraîchissement.')
}

export function isEpicConnected(): { connected: boolean; displayName?: string } {
  const e = getAuth().epic
  return e ? { connected: true, displayName: e.displayName } : { connected: false }
}

export function epicLogout(): void {
  saveAuth({ epic: undefined })
  void session.fromPartition(PARTITION).clearStorageData()
}

/** Récupère un authorizationCode via la session persistée (cookies), sans fenêtre. */
async function fetchAuthorizationCode(): Promise<string | null> {
  try {
    const ses = session.fromPartition(PARTITION)
    // Timeout : un fetch de session pendu sans limite bloquerait la sync entière (verrou `syncing`)
    const res = await ses.fetch(REDIRECT_URL, { credentials: 'include', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { authorizationCode?: string }
    return body.authorizationCode ?? null
  } catch {
    return null
  }
}

/** Ouvre la fenêtre de connexion officielle Epic et échange le code obtenu. */
export async function epicLogin(parent: BrowserWindow | null): Promise<{ displayName: string }> {
  // Déjà connecté via cookies ? Pas besoin de fenêtre.
  const silentCode = await fetchAuthorizationCode()
  if (silentCode) {
    const auth = await exchange({ grant_type: 'authorization_code', code: silentCode, token_type: 'eg1' })
    saveAuth({ epic: auth })
    return { displayName: auth.displayName }
  }

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 760,
      parent: parent ?? undefined,
      title: 'Connexion Epic Games',
      autoHideMenuBar: true,
      backgroundColor: '#121212',
      webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true }
    })
    let settled = false
    let poll: NodeJS.Timeout | null = null

    const finish = async (): Promise<void> => {
      if (settled) return
      const code = await fetchAuthorizationCode()
      if (!code) return
      settled = true
      if (poll) clearInterval(poll)
      try {
        const auth = await exchange({ grant_type: 'authorization_code', code, token_type: 'eg1' })
        saveAuth({ epic: auth })
        if (!win.isDestroyed()) win.close()
        resolve({ displayName: auth.displayName })
      } catch (e) {
        if (!win.isDestroyed()) win.close()
        reject(e as Error)
      }
    }

    // une fois connecté, l'utilisateur atterrit sur une page epicgames.com → on sonde le code
    win.webContents.on('did-navigate', () => void finish())
    win.webContents.on('did-navigate-in-page', () => void finish())
    poll = setInterval(() => void finish(), 2_500)
    win.on('closed', () => {
      if (poll) clearInterval(poll)
      if (!settled) reject(new Error('Fenêtre fermée avant la fin de la connexion Epic.'))
    })
    void win.loadURL(LOGIN_URL)
  })
}
