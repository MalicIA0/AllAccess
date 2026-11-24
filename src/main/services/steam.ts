import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, session } from 'electron'
import type { Achievement, AppItem, Game } from '../../shared/types'
import { fetchSteamOwnedAppIds, getSteamAccess, isSteamConnected } from './steamAuth'
import { deleteGame, getGames, removeBonusDuplicates, setDlcCounts, setGameInstalled, upsertAchievements, upsertApp, upsertGame } from './db'
import { alog } from './achievementLog'

const execFileAsync = promisify(execFile)
const API = 'https://api.steampowered.com'
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'

/* ------------------------------------------------------------------ */
/*  Scan local : dossiers Steam, jeux installés, exe hints            */
/* ------------------------------------------------------------------ */

export async function getSteamRoot(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'])
    const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (m) {
      const p = m[1].trim().replace(/\//g, '\\')
      if (existsSync(p)) return p
    }
  } catch {
    /* registre absent */
  }
  for (const p of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) {
    if (existsSync(p)) return p
  }
  return null
}

export function parseLibraryFolders(steamRoot: string): string[] {
  const vdf = join(steamRoot, 'steamapps', 'libraryfolders.vdf')
  // Dédoublonnage insensible à la casse : le registre renvoie le chemin en minuscules
  // (« c:\program files (x86)\steam ») et libraryfolders.vdf en casse d'origine. Un Set
  // sensible à la casse gardait donc DEUX entrées pour un même dossier, et chaque jeu était
  // scanné (et remonté) en double.
  const byKey = new Map<string, string>()
  const add = (p: string): void => {
    if (existsSync(p)) byKey.set(p.toLowerCase().replace(/[\\/]+$/, ''), p)
  }
  add(join(steamRoot, 'steamapps'))
  if (existsSync(vdf)) {
    const content = readFileSync(vdf, 'utf-8')
    for (const m of content.matchAll(/"path"\s+"([^"]+)"/g)) {
      add(join(m[1].replace(/\\\\/g, '\\'), 'steamapps'))
    }
  }
  return [...byKey.values()]
}

const EXE_BLACKLIST =
  /unins|crash|redist|vcredist|dxsetup|dotnet|setup|installer|unitycrashhandler|report|eac|easyanticheat|launcherhelper|touchup/i

function findExeHints(dir: string, depth = 0): string[] {
  const hints: string[] = []
  if (depth > 2 || !existsSync(dir)) return hints
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe') && !EXE_BLACKLIST.test(entry.name)) {
        hints.push(entry.name.toLowerCase())
      } else if (entry.isDirectory() && depth < 2 && /bin|x64|win64|game/i.test(entry.name)) {
        hints.push(...findExeHints(join(dir, entry.name), depth + 1))
      }
    }
  } catch {
    /* accès refusé — ignore */
  }
  return [...new Set(hints)].slice(0, 8)
}

interface InstalledApp {
  installDir: string
  exeHints: string[]
}

export async function scanInstalledSteamGames(): Promise<Map<string, InstalledApp>> {
  const result = new Map<string, InstalledApp>()
  const root = await getSteamRoot()
  if (!root) return result
  for (const lib of parseLibraryFolders(root)) {
    let files: string[] = []
    try {
      files = readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const content = readFileSync(join(lib, f), 'utf-8')
        const appid = content.match(/"appid"\s+"(\d+)"/)?.[1]
        const installdir = content.match(/"installdir"\s+"([^"]+)"/)?.[1]
        if (!appid || !installdir) continue
        // Un jeu en cours de téléchargement a déjà son manifeste + son dossier, mais n'est pas
        // jouable : on exige le bit FullyInstalled (4) des StateFlags pour le compter installé.
        const stateFlags = Number(content.match(/"StateFlags"\s+"(\d+)"/)?.[1] ?? 0)
        if ((stateFlags & 4) === 0) continue
        const full = join(lib, 'common', installdir)
        if (!existsSync(full)) continue
        result.set(appid, { installDir: full, exeHints: findExeHints(full) })
      } catch {
        /* manifeste illisible */
      }
    }
  }
  return result
}

export interface SteamOnDiskGame {
  appid: string
  name: string
  installDir: string
  fullyInstalled: boolean
  downloadedBytes: number
  totalBytes: number
}

/**
 * TOUS les jeux Steam présents sur disque via leur appmanifest — y compris ceux en cours
 * de TÉLÉCHARGEMENT (bit FullyInstalled absent). Sert à faire apparaître un jeu tout juste
 * acheté/installé avant même que l'API GetOwnedGames ne le liste, avec sa progression.
 */
export async function scanSteamOnDisk(): Promise<SteamOnDiskGame[]> {
  const out: SteamOnDiskGame[] = []
  const root = await getSteamRoot()
  if (!root) return out
  for (const lib of parseLibraryFolders(root)) {
    let files: string[] = []
    try {
      files = readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const c = readFileSync(join(lib, f), 'utf-8')
        const appid = c.match(/"appid"\s+"(\d+)"/)?.[1]
        const name = c.match(/"name"\s+"([^"]+)"/)?.[1]
        const installdir = c.match(/"installdir"\s+"([^"]+)"/)?.[1]
        if (!appid || !installdir) continue
        const state = Number(c.match(/"StateFlags"\s+"(\d+)"/)?.[1] ?? 0)
        out.push({
          appid,
          name: name ?? `Jeu Steam ${appid}`,
          installDir: join(lib, 'common', installdir),
          fullyInstalled: (state & 4) !== 0,
          downloadedBytes: Number(c.match(/"BytesDownloaded"\s+"(\d+)"/)?.[1] ?? 0),
          totalBytes: Number(c.match(/"BytesToDownload"\s+"(\d+)"/)?.[1] ?? 0)
        })
      } catch {
        /* manifeste illisible */
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Steam Web API                                                     */
/* ------------------------------------------------------------------ */

async function apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Steam API ${path} → HTTP ${res.status}`)
  return (await res.json()) as T
}

interface OwnedGamesResponse {
  response: {
    game_count?: number
    games?: {
      appid: number
      name: string
      playtime_forever: number
      rtime_last_played?: number
    }[]
  }
}

/* ------------------------------------------------------------------ */
/*  Distinction jeu / application (benchmark, wallpaper, outils…)     */
/* ------------------------------------------------------------------ */

// Steam catalogue certains outils créatifs comme type "game" (visibilité boutique) —
// le champ "type" de l'API ne suffit pas à les distinguer, exceptions connues à la main.
const KNOWN_TOOL_APPIDS = new Set([
  '431960', // Wallpaper Engine
  '1325860' // VTube Studio
])

function appTypeCachePath(): string {
  return join(app.getPath('userData'), 'steam-apptype-cache.json')
}

let appTypeCache: Record<string, string> | null = null

function loadAppTypeCache(): Record<string, string> {
  if (appTypeCache) return appTypeCache
  try {
    appTypeCache = JSON.parse(readFileSync(appTypeCachePath(), 'utf-8')) as Record<string, string>
  } catch {
    appTypeCache = {}
  }
  return appTypeCache
}

function saveAppTypeCache(): void {
  try {
    writeFileSync(appTypeCachePath(), JSON.stringify(appTypeCache ?? {}), 'utf-8')
  } catch {
    /* pas grave, re-résolu au prochain sync */
  }
}

/** "game" | "application" | "dlc" | "demo" | "tool" | "video" | … — le type ne change jamais, mis en cache indéfiniment. */
async function fetchAppType(appid: string): Promise<string | null> {
  const cache = loadAppTypeCache()
  if (cache[appid]) return cache[appid]
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, { success?: boolean; data?: { type?: string } }>
    const type = data[appid]?.data?.type ?? null
    if (type) {
      cache[appid] = type
      saveAppTypeCache()
    }
    return type
  } catch {
    return null
  }
}

export async function fetchSteamLibrary(): Promise<{ games: Game[]; apps: AppItem[] }> {
  const { token, steamId64 } = await getSteamAccess()

  const [owned, installed] = await Promise.all([
    apiGet<OwnedGamesResponse>('/IPlayerService/GetOwnedGames/v1/', {
      access_token: token,
      steamid: steamId64,
      include_appinfo: '1',
      include_played_free_games: '1'
    }),
    scanInstalledSteamGames()
  ])

  const owned_ = owned.response.games ?? []
  // Résout le type de chaque app (jeu vs outil/benchmark/wallpaper…) avec concurrence limitée
  const types = new Map<string, string | null>()
  const queue = [...owned_]
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        types.set(String(g.appid), await fetchAppType(String(g.appid)))
      }
    })
  )

  const games: Game[] = []
  const apps: AppItem[] = []
  for (const g of owned_) {
    const appid = String(g.appid)
    const inst = installed.get(appid)
    const type = types.get(appid)
    const isApp = KNOWN_TOOL_APPIDS.has(appid) || (type != null && type !== 'game')
    const coverUrl = `${CDN}/${appid}/library_600x900.jpg`

    if (isApp) {
      apps.push({
        id: `app:steam:${appid}`,
        platform: 'steam',
        productId: appid,
        name: g.name,
        installed: !!inst,
        coverUrl,
        updatedAt: Date.now()
      })
      continue
    }

    const game: Game = {
      id: `steam:${appid}`,
      platform: 'steam',
      externalId: appid,
      name: g.name,
      ownership: 'owned',
      ownershipOverride: null,
      hidden: false,
      installed: !!inst,
      installDir: inst?.installDir ?? null,
      exeHints: inst?.exeHints ?? [],
      devices: ['PC'],
      playtimeMinutes: g.playtime_forever,
      lastPlayed: g.rtime_last_played ? g.rtime_last_played * 1000 : null,
      coverUrl,
      heroUrl: `${CDN}/${appid}/library_hero.jpg`,
      storeProductId: null,
      achievementsTotal: 0,
      achievementsUnlocked: 0,
      dlcOwned: 0,
      dlcTotal: 0,
      updatedAt: Date.now()
    }
    upsertGame(game)
    games.push(game)
  }
  return { games, apps }
}

/**
 * Fait apparaître les jeux Steam présents SUR DISQUE (via appmanifest), qu'ils soient déjà
 * dans la bibliothèque API ou non — INDÉPENDAMMENT de l'API Steam. Sert les cas où l'API
 * échoue (token expiré) ou n'a pas encore le jeu (achat très récent, téléchargement en cours) :
 *  - jeu absent de la base → on crée sa fiche (nom + jaquette CDN + statut installé) ;
 *  - jeu déjà en base → on réconcilie juste son statut « installé » (installé/désinstallé).
 * Aucun réseau requis. Les succès et le reste seront enrichis à la prochaine sync API réussie.
 */
// Runtimes / redistribuables Steam : jamais de vrais contenus utilisateur — ne doivent
// apparaître NI dans la bibliothèque NI dans les applications.
const STEAM_SKIP_APPIDS = new Set([
  '228980', // Steamworks Common Redistributables
  '1070560', // Steam Linux Runtime 1.0 (Scout)
  '1391110', // Steam Linux Runtime 2.0 (Soldier)
  '1493710', // Proton Experimental
  '1826330', // Proton 8.0 / autres runtimes
  '2180100', // Proton Hotfix
  '1887720' // Proton 7.0
])

export async function syncSteamOnDiskGames(): Promise<void> {
  const onDisk = await scanSteamOnDisk()
  if (onDisk.length === 0) return
  const existing = new Map(getGames().filter((g) => g.platform === 'steam').map((g) => [g.externalId, g]))
  for (const d of onDisk) {
    const g = existing.get(d.appid)

    // 1) Runtime/redistribuable : on l'exclut totalement (et on purge une éventuelle fiche créée à tort).
    if (STEAM_SKIP_APPIDS.has(d.appid)) {
      if (g) deleteGame(g.id)
      continue
    }

    // 2) Type : seuls les vrais JEUX vont dans la Bibliothèque ; les outils/benchmarks/wallpapers
    //    (type ≠ "game") vont dans APPLICATIONS. type null (API injoignable) = on suppose un jeu.
    const type = KNOWN_TOOL_APPIDS.has(d.appid) ? 'tool' : await fetchAppType(d.appid)
    const isApp = KNOWN_TOOL_APPIDS.has(d.appid) || (type != null && type !== 'game')

    if (isApp) {
      if (g) deleteGame(g.id) // deplace hors de la Bibliothèque
      upsertApp({
        id: `app:steam:${d.appid}`,
        platform: 'steam',
        productId: d.appid,
        name: d.name,
        installed: d.fullyInstalled,
        coverUrl: `${CDN}/${d.appid}/library_600x900.jpg`
      })
      continue
    }

    // 3) Vrai jeu : réconcilie l'installation si déjà en base, sinon crée la fiche.
    if (g) {
      if (g.installed !== d.fullyInstalled) setGameInstalled(g.id, d.fullyInstalled)
      continue
    }
    upsertGame({
      id: `steam:${d.appid}`,
      platform: 'steam',
      externalId: d.appid,
      name: d.name,
      ownership: 'owned',
      installed: d.fullyInstalled,
      installDir: d.installDir,
      exeHints: [],
      devices: ['PC'],
      playtimeMinutes: 0,
      lastPlayed: null,
      coverUrl: `${CDN}/${d.appid}/library_600x900.jpg`,
      heroUrl: `${CDN}/${d.appid}/library_hero.jpg`,
      storeProductId: null,
      achievementsTotal: 0,
      achievementsUnlocked: 0,
      dlcOwned: 0,
      dlcTotal: 0
    })
  }
}

/* ------------------------------------------------------------------ */
/*  DLC possédés                                                      */
/* ------------------------------------------------------------------ */

interface DlcEntry {
  dlc: number[]
  fetchedAt: number
}
let dlcListCache: Record<string, DlcEntry> | null = null

function dlcCachePath(): string {
  return join(app.getPath('userData'), 'steam-dlc-cache.json')
}
function loadDlcCache(): Record<string, DlcEntry> {
  if (dlcListCache) return dlcListCache
  try {
    dlcListCache = JSON.parse(readFileSync(dlcCachePath(), 'utf-8')) as Record<string, DlcEntry>
  } catch {
    dlcListCache = {}
  }
  return dlcListCache
}
function saveDlcCache(): void {
  try {
    writeFileSync(dlcCachePath(), JSON.stringify(dlcListCache ?? {}), 'utf-8')
  } catch {
    /* pas grave */
  }
}

const DLC_TTL = 7 * 86400_000

/** Liste des appids de DLC d'un jeu (via appdetails), mise en cache 7 jours. */
async function fetchDlcList(appid: string): Promise<number[]> {
  const cache = loadDlcCache()
  const hit = cache[appid]
  if (hit && Date.now() - hit.fetchedAt < DLC_TTL) return hit.dlc
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=french`, {
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) return hit?.dlc ?? []
    const data = (await res.json()) as Record<string, { success?: boolean; data?: { dlc?: number[] } }>
    const dlc = data[appid]?.data?.dlc ?? []
    cache[appid] = { dlc, fetchedAt: Date.now() }
    saveDlcCache()
    return dlc
  } catch {
    return hit?.dlc ?? []
  }
}

/**
 * Calcule, pour les jeux Steam joués ou installés, combien de leurs DLC l'utilisateur possède.
 * Best-effort : si la liste des apps possédées est indisponible (session Store absente), on n'affiche rien.
 */
export async function syncSteamDlc(games: Game[]): Promise<void> {
  const owned = await fetchSteamOwnedAppIds()
  if (owned.size === 0) return // pas de session Store → on ne devine pas
  // Se limite aux jeux pertinents pour rester dans les quotas d'appdetails
  const targets = games.filter((g) => g.platform === 'steam' && (g.playtimeMinutes > 0 || g.installed))
  const queue = [...targets]
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let g = queue.shift(); g; g = queue.shift()) {
        const dlcIds = await fetchDlcList(g.externalId)
        if (dlcIds.length === 0) {
          setDlcCounts(g.id, 0, 0)
          continue
        }
        const ownedCount = dlcIds.filter((id) => owned.has(id)).length
        setDlcCounts(g.id, ownedCount, dlcIds.length)
        await new Promise((r) => setTimeout(r, 120))
      }
    })
  )
}

/* ------------------------------------------------------------------ */
/*  Succès — via pages communautaires publiques (aucune clé API)      */
/*                                                                    */
/*  L'API officielle ISteamUserStats exige une clé développeur (le    */
/*  jeton de session renvoie HTTP 400). On lit donc :                 */
/*   • la page GLOBALE du jeu  → tous les succès (nom, desc, icône,   */
/*     rareté), sans authentification ;                               */
/*   • la page PERSO du joueur → les succès débloqués (nécessite que  */
/*     « Détails du jeu » du profil Steam soit réglé sur Public).     */
/* ------------------------------------------------------------------ */

const STEAM_PARTITION = 'persist:steam'

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Hash d'icône = identifiant stable d'un succès, identique sur les deux pages. */
function iconHash(src: string): string | null {
  return src.match(/\/([a-f0-9]{20,})\.(?:jpg|png)/i)?.[1] ?? null
}

interface ParsedAch {
  key: string // hash d'icône
  name: string
  description: string
  icon: string
  rarity: number | null
}

/** Parse la page globale du jeu : TOUS les succès. */
function parseGlobalAchievements(html: string): ParsedAch[] {
  const out: ParsedAch[] = []
  for (const row of html.split('class="achieveRow').slice(1)) {
    const icon = row.match(/achieveImgHolder[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1]
    const key = icon ? iconHash(icon) : null
    const name = row.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
    if (!key || !icon || !name) continue
    const desc = row.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i)?.[1] ?? ''
    const pct = row.match(/achievePercent[^>]*>([\d.,]+)\s*%/i)?.[1]
    out.push({
      key,
      name: decodeEntities(name),
      description: decodeEntities(desc),
      icon: icon.replace(/^http:/, 'https:'),
      rarity: pct ? Number(pct.replace(',', '.')) : null
    })
  }
  return out
}

/** Parse la page perso : hash des succès débloqués (chaque ligne y porte une date de déblocage). */
function parseUnlockedHashes(html: string): Set<string> {
  const set = new Set<string>()
  for (const row of html.split('class="achieveRow').slice(1)) {
    if (!/achieveUnlockTime/i.test(row)) continue // sécurité : seulement les lignes réellement débloquées
    const icon = row.match(/achieveImgHolder[\s\S]*?<img[^>]+src="([^"]+)"/i)?.[1]
    const key = icon ? iconHash(icon) : null
    if (key) set.add(key)
  }
  return set
}

/* ------------------------------------------------------------------ */
/*  Nouveau format Steam (fin 2026) : pages React rendues côté serveur */
/*                                                                    */
/*  Steam a refondu /stats/{appid}/achievements (redirigé vers         */
/*  /achievements/{appid}) : plus aucune ligne `achieveRow`, classes   */
/*  CSS hachées. Les données sont dans <script id="valve-ssr-data"> :  */
/*  renderContext.queryData (JSON en chaîne) → queries[] react-query : */
/*   • ["achievements", appid, "schema_v2"]        → liste + icônes    */
/*   • ["achievements", appid, "globalpercentages"] → rareté par clé   */
/*   • ["achievements", appid, "user_achievements", steamid] → unlocks */
/*  Le hash de `icon_achieved` = celui de l'ancienne icône HTML → les  */
/*  clés déjà en base restent valides.                                 */
/* ------------------------------------------------------------------ */

const STEAM_ICON_BASE = 'https://shared.akamai.steamstatic.com/community_assets/images/apps'

type SsrQuery = { queryKey?: unknown[]; state?: { data?: unknown } }

function ssrQueries(html: string): SsrQuery[] {
  const raw = html.match(/<script[^>]+id="valve-ssr-data"[^>]*>([\s\S]*?)<\/script>/i)?.[1]
  if (!raw) return []
  try {
    const ssr = JSON.parse(raw) as { renderContext?: { queryData?: unknown } }
    let qd = ssr.renderContext?.queryData
    if (typeof qd === 'string') qd = JSON.parse(qd)
    return ((qd as { queries?: SsrQuery[] })?.queries ?? []) as SsrQuery[]
  } catch {
    return []
  }
}

function ssrData<T>(queries: SsrQuery[], kind: string): T | null {
  const q = queries.find((x) => x.queryKey?.[0] === 'achievements' && x.queryKey?.[2] === kind)
  return (q?.state?.data as T) ?? null
}

interface SchemaV2 {
  groups?: {
    achievements?: {
      internal_key: number
      name?: string
      description?: string
      icon_achieved?: string
      archived?: boolean
    }[]
  }[]
}

/** Nouveau format : liste complète (clé = hash d'icône, comme l'ancien format). */
function parseGlobalAchievementsSsr(html: string, appid: string): ParsedAch[] {
  const queries = ssrQueries(html)
  const schema = ssrData<SchemaV2>(queries, 'schema_v2')
  const pct = ssrData<{ percentages?: Record<string, number> }>(queries, 'globalpercentages')?.percentages ?? {}
  const out: ParsedAch[] = []
  for (const g of schema?.groups ?? []) {
    for (const a of g.achievements ?? []) {
      if (a.archived || !a.icon_achieved) continue
      const key = a.icon_achieved.replace(/\.(jpg|png)$/i, '')
      const rarity = pct[String(a.internal_key)]
      out.push({
        key,
        name: (a.name ?? '').trim() || key,
        description: (a.description ?? '').trim(),
        icon: `${STEAM_ICON_BASE}/${appid}/${a.icon_achieved}`,
        rarity: typeof rarity === 'number' ? Math.round(rarity * 10) / 10 : null
      })
    }
  }
  return out
}

/**
 * Nouveau format : succès débloqués du joueur → Map(hash d'icône → date de déblocage en ms).
 * Retourne null si la page n'est pas au nouveau format (on retombe alors sur l'ancien parseur).
 */
function parseUnlockedSsr(html: string): Map<string, number> | null {
  const queries = ssrQueries(html)
  const schema = ssrData<SchemaV2>(queries, 'schema_v2')
  const user = ssrData<{ achievements?: Record<string, { unlocked?: boolean; unlock_time?: number }> }>(
    queries,
    'user_achievements'
  )
  if (!schema || !user) return null
  const iconByInternal = new Map<number, string>()
  for (const g of schema.groups ?? [])
    for (const a of g.achievements ?? [])
      if (a.icon_achieved) iconByInternal.set(a.internal_key, a.icon_achieved.replace(/\.(jpg|png)$/i, ''))
  const out = new Map<string, number>()
  for (const [k, v] of Object.entries(user.achievements ?? {})) {
    if (!v.unlocked) continue // entrées « progress » sans déblocage
    const key = iconByInternal.get(Number(k))
    if (key) out.set(key, v.unlock_time ? v.unlock_time * 1000 : Date.now())
  }
  return out
}

/* Cache disque de la liste globale (noms/icônes/rareté changent peu) — 7 jours. */
interface GlobalAchCache {
  fetchedAt: number
  list: ParsedAch[]
}
let achListCache: Record<string, GlobalAchCache> | null = null
function achListCachePath(): string {
  return join(app.getPath('userData'), 'steam-ach-cache.json')
}
function loadAchListCache(): Record<string, GlobalAchCache> {
  if (achListCache) return achListCache
  try {
    achListCache = JSON.parse(readFileSync(achListCachePath(), 'utf-8')) as Record<string, GlobalAchCache>
  } catch {
    achListCache = {}
  }
  return achListCache
}
function saveAchListCache(): void {
  try {
    writeFileSync(achListCachePath(), JSON.stringify(achListCache ?? {}), 'utf-8')
  } catch {
    /* pas grave, re-fetch au prochain sync */
  }
}

const ACH_LIST_TTL = 7 * 86400_000

/**
 * Liste complète des succès d'un jeu (page communautaire publique), avec cache 7 j.
 *
 * Les pages communautaires sont volontiers lentes ou limitées en débit quand le poller les
 * interroge en boucle. Un échec y était SILENCIEUX et définitif : liste vide → `syncSteamAchievements`
 * abandonnait sans rien écrire ni tracer, et le jeu restait à 0 succès pour toujours (constaté sur
 * Marvel's Spider-Man 2 : 43 succès existants, aucun en base, aucune ligne de log). D'où :
 * plusieurs tentatives espacées, puis une trace explicite si ça échoue quand même.
 */
async function getGlobalAchievements(ses: Electron.Session, appid: string): Promise<ParsedAch[]> {
  const cache = loadAchListCache()
  const hit = cache[appid]
  if (hit && Date.now() - hit.fetchedAt < ACH_LIST_TTL) return hit.list

  let lastIssue = 'inconnu'
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // URL directe du nouveau format : l'ancienne (/stats/…) redirige ici mais PERD `?l=french`
      const res = await ses.fetch(`https://steamcommunity.com/achievements/${appid}?l=french`, {
        signal: AbortSignal.timeout(20_000)
      })
      if (!res.ok) {
        lastIssue = `HTTP ${res.status}`
      } else {
        const html = await res.text()
        let list = parseGlobalAchievementsSsr(html, appid)
        if (list.length === 0) list = parseGlobalAchievements(html) // ancien format, au cas où
        if (list.length > 0) {
          cache[appid] = { fetchedAt: Date.now(), list }
          saveAchListCache()
          return list
        }
        lastIssue = 'page sans succès (jeu sans succès, ou page inattendue)'
      }
    } catch (e) {
      lastIssue = (e as Error).message
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500))
  }
  // Une liste vide n'est plus une impasse muette : on sait pourquoi, et on garde le cache s'il existe.
  alog(`liste de succes Steam indisponible (appid ${appid}, ${lastIssue})`)
  return hit?.list ?? []
}

/** Récupère + stocke les succès d'un jeu Steam. Retourne les succès nouvellement débloqués. */
export async function syncSteamAchievements(appid: string): Promise<Achievement[]> {
  const steamId64 = isSteamConnected().steamId64
  if (!steamId64) return []
  const gameId = `steam:${appid}`
  const ses = session.fromPartition(STEAM_PARTITION)

  // 1) liste complète du jeu (cache 7j)
  const all = await getGlobalAchievements(ses, appid)
  if (all.length === 0) return []

  // 2) succès débloqués du joueur (page perso — nécessite « Détails du jeu » = Public)
  // clé → date de déblocage (exacte au nouveau format ; heure de sync à l'ancien, figée par le COALESCE en base)
  let unlocked = new Map<string, number>()
  try {
    const res = await ses.fetch(
      `https://steamcommunity.com/profiles/${steamId64}/stats/${appid}/achievements/?l=french`,
      { credentials: 'include', signal: AbortSignal.timeout(20_000) }
    )
    if (res.ok) {
      const html = await res.text()
      const now = Date.now()
      unlocked = parseUnlockedSsr(html) ?? new Map([...parseUnlockedHashes(html)].map((k) => [k, now]))
    } else {
      alog(`page succes perso Steam indisponible (appid ${appid}, HTTP ${res.status})`)
    }
  } catch (e) {
    /* détails privés ou réseau — on garde tout verrouillé */
    alog(`page succes perso Steam en echec (appid ${appid}) : ${(e as Error).message}`)
  }

  const achievements: Achievement[] = all.map((a) => ({
    gameId,
    key: a.key,
    name: a.name,
    description: a.description,
    iconUrl: a.icon,
    iconGrayUrl: a.icon,
    unlocked: unlocked.has(a.key),
    unlockTime: unlocked.get(a.key) ?? null,
    rarity: a.rarity
  }))

  const newly = upsertAchievements(gameId, achievements)
  removeBonusDuplicates(gameId) // enlève les imports Xbox manuels devenus redondants
  return newly
}

/**
 * Sync des succès pour les jeux INSTALLÉS uniquement, avec concurrence limitée — un jeu non
 * installé ne peut pas débloquer de nouveau succès entre deux syncs, inutile de le vérifier
 * à chaque fois (ça alourdit la synchro pour rien sur une grosse bibliothèque).
 */
export async function syncAllSteamAchievements(
  games: Game[],
  onProgress: (done: number, total: number, name: string) => void
): Promise<void> {
  // Uniquement les jeux installés et non masqués (même règle que Xbox).
  const targets = games.filter((g) => g.installed && !g.hidden)
  let done = 0
  const queue = [...targets]
  const workers = Array.from({ length: 2 }, async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        await syncSteamAchievements(g.externalId)
      } catch {
        /* jeu sans succès ou détails de jeu privés */
      }
      onProgress(++done, targets.length, g.name)
      await new Promise((r) => setTimeout(r, 200)) // ménage les pages communautaires
    }
  })
  await Promise.all(workers)
}
