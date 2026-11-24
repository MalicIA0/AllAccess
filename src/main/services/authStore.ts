import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/** Jetons de session chiffrés (DPAPI) — jamais de mot de passe, uniquement des jetons révocables. */

export interface SteamAuth {
  steamId64: string
  token: string // webapi_token (JWT)
  exp: number // ms epoch
}

export interface XboxAuth {
  msToken: string
  msExp: number
  xstsToken: string
  xstsExp: number
  uhs: string
  xuid: string
  gamertag: string
  /** Jeton de rafraîchissement Microsoft (flux code) — permet la reconnexion silencieuse
   *  pendant des semaines sans redemander le login. Absent pour les vieilles sessions (flux implicite). */
  refreshToken?: string
  refreshExp?: number
}

export interface EpicAuth {
  accessToken: string
  accessExp: number // ms epoch
  refreshToken: string
  refreshExp: number // ms epoch
  accountId: string
  displayName: string
}

export interface AuthData {
  steam?: SteamAuth
  xbox?: XboxAuth
  epic?: EpicAuth
}

let cache: AuthData | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'auth.bin')
}

export function getAuth(): AuthData {
  if (cache) return cache
  if (!existsSync(filePath())) {
    cache = {}
    return cache
  }
  try {
    const raw = readFileSync(filePath())
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8')
    cache = JSON.parse(json) as AuthData
  } catch {
    cache = {}
  }
  return cache
}

export function saveAuth(patch: Partial<AuthData>): void {
  const data = { ...getAuth(), ...patch }
  // une clé explicitement à undefined = déconnexion
  for (const k of Object.keys(data) as (keyof AuthData)[]) if (data[k] === undefined) delete data[k]
  const json = JSON.stringify(data)
  writeFileSync(filePath(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json))
  cache = data
}
