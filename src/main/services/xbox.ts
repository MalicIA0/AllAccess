import type { Achievement, Game } from '../../shared/types'
import { getXboxAccess, xboxApiHeaders } from './xboxAuth'
import { getGames, setDlcCounts, setGameInstalled, upsertAchievements, upsertGame } from './db'
import { scanXboxOnDiskGames } from './xboxDownload'
import {
  getGamePassCatalog,
  isOnGamePass,
  normalizeName,
  resolveByXboxTitleId,
  type ResolvedProduct,
  type StoreArt
} from './gamepass'
import { fetchOwnedAddons, fetchPurchasedGames } from './msStore'

/** Endpoints officiels Xbox Live, appelés avec la session de l'utilisateur (XSTS). */

// Codes HTTP transitoires : l'API achievements.xboxlive.com renvoie très souvent des
// 503 passagers (et parfois 429/500/502/504). Sans réessai, un simple hoquet faisait
// rater tout un poll de succès → bannière perdue. On réessaie donc quelques fois.
const XBL_TRANSIENT = new Set([429, 500, 502, 503, 504])

async function xblGet<T>(url: string, contractVersion = '2'): Promise<T> {
  const auth = await getXboxAccess()
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt)) // 0,6s / 1,2s / 1,8s
    try {
      const res = await fetch(url, {
        headers: { ...xboxApiHeaders(auth), 'x-xbl-contract-version': contractVersion },
        signal: AbortSignal.timeout(25_000)
      })
      if (res.ok) return (await res.json()) as T
      const err = new Error(`Xbox Live ${new URL(url).pathname} → HTTP ${res.status}`)
      if (!XBL_TRANSIENT.has(res.status)) throw err // 401/403/404… : inutile de réessayer
      lastErr = err // transitoire → nouvelle tentative
    } catch (e) {
      // Erreur non transitoire déjà identifiée (HTTP 4xx hors liste) : on abandonne tout de suite.
      if (e instanceof Error && /HTTP (400|401|403|404)/.test(e.message)) throw e
      lastErr = e as Error // réseau / timeout / transitoire → nouvelle tentative
    }
  }
  throw lastErr ?? new Error('Xbox Live: échec inconnu')
}

interface XblTitle {
  titleId: string
  pfn?: string
  name: string
  displayImage?: string
  type?: string
  devices?: string[]
  achievement?: {
    currentAchievements: number
    totalAchievements: number
    currentGamerscore: number
    totalGamerscore: number
    progressPercentage: number
  }
  titleHistory?: { lastTimePlayed?: string }
}

interface TitleHistoryResponse {
  titles?: XblTitle[]
}

/** Appareils considérés comme "jouable sur PC" dans les métadonnées titlehub. */
const PC_DEVICES = new Set(['PC', 'Win32', 'WindowsOneCore', 'WindowsDesktop', 'Desktop'])

function isPcTitle(t: XblTitle): boolean {
  return (t.devices ?? []).some((d) => PC_DEVICES.has(d))
}

/**
 * Bibliothèque Xbox : uniquement les jeux jouables sur PC qui sont
 * soit réellement achetés sur le compte, soit dans le Game Pass actuel.
 * (L'historique brut contient aussi les jeux console et les anciens jeux
 * Game Pass retirés du catalogue — on les exclut.)
 * `safeToPrune` est faux si la résolution du catalogue Store a partiellement échoué : dans ce cas
 * on ne peut pas distinguer un titre plus possédé d'un titre dont la vérification a juste échoué,
 * donc l'appelant doit s'abstenir de purger la base pour ne pas supprimer un jeu possédé à tort.
 */
export async function fetchXboxLibrary(): Promise<{ games: Game[]; safeToPrune: boolean }> {
  const auth = await getXboxAccess()
  const data = await xblGet<TitleHistoryResponse>(
    `https://titlehub.xboxlive.com/users/xuid(${auth.xuid})/titles/titlehistory/decoration/achievement,image,detail?maxItems=1000`
  )

  // Achats réels du compte + visuels/productId du Store pour compléter jaquettes et installation
  const purchased = await fetchPurchasedGames()
  const catalog = await getGamePassCatalog().catch(
    () => ({ art: {}, productIds: {} }) as { art: Record<string, StoreArt>; productIds: Record<string, string> }
  )
  const purchasedArt: Record<string, StoreArt> = {}
  const purchasedProductIds: Record<string, string> = {}
  for (const p of purchased?.products ?? []) {
    const n = normalizeName(p.title)
    purchasedArt[n] = p.art
    if (p.productId) purchasedProductIds[n] = p.productId
    if (p.pfn) {
      purchasedArt[p.pfn.toLowerCase()] = p.art
      if (p.productId) purchasedProductIds[p.pfn.toLowerCase()] = p.productId
    }
  }
  const artFor = (name: string, pfn?: string): StoreArt | undefined => {
    for (const key of [pfn?.toLowerCase(), normalizeName(name)]) {
      if (!key) continue
      const a = purchasedArt[key] ?? catalog.art[key]
      if (a) return a
    }
    return undefined
  }
  const productIdFor = (name: string, pfn?: string): string | null => {
    for (const key of [pfn?.toLowerCase(), normalizeName(name)]) {
      if (!key) continue
      const id = purchasedProductIds[key] ?? catalog.productIds[key]
      if (id) return id
    }
    return null
  }

  // Filtre d'abord la liste (jeux PC, achetés ou Game Pass) avant les lookups réseau
  const candidates: { t: XblTitle; achievement: NonNullable<XblTitle['achievement']>; owned: boolean; gamepass: boolean }[] =
    []
  for (const t of data.titles ?? []) {
    // Ignore les applications non-jeux
    if (t.type && t.type !== 'Game') continue
    if (!t.achievement || t.achievement.totalGamerscore === 0) continue
    // Uniquement les jeux jouables sur PC
    if (!isPcTitle(t)) continue

    const gamepass = await isOnGamePass(t.name, t.pfn)
    const matched = purchased
      ? (!!t.pfn && purchased.pfns.has(t.pfn.toLowerCase())) || purchased.names.has(normalizeName(t.name))
      : false
    const owned = purchased ? matched : !gamepass // fallback si l'API des achats est indisponible
    // Ni acheté ni dans l'abonnement actuel (ex. ancien jeu Game Pass, essai) → hors bibliothèque…
    // …sauf si la résolution du catalogue Store a partiellement échoué : dans ce cas on ne peut pas
    // affirmer que ce titre n'est plus possédé, donc on le garde par prudence (pas de perte de données).
    if (!owned && !gamepass) {
      if (!purchased?.partial) continue
    }
    candidates.push({ t, achievement: t.achievement, owned: owned || (!matched && !!purchased?.partial), gamepass })
  }

  // Résolution fiable par titleId (bien plus robuste que le matching par nom) — concurrence limitée
  const titleIdMatches = new Map<string, ResolvedProduct | null>()
  const queue = [...candidates]
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        titleIdMatches.set(c.t.titleId, await resolveByXboxTitleId(c.t.titleId))
      }
    })
  )

  const games: Game[] = []
  for (const { t, achievement, owned, gamepass } of candidates) {
    // le Store renvoie des URLs http:// — la CSP du renderer n'accepte que https://
    const image = t.displayImage?.replace(/^http:\/\//, 'https://') ?? null
    const direct = titleIdMatches.get(t.titleId)
    const art = direct?.art ?? artFor(t.name, t.pfn)
    const game: Game = {
      id: `xbox:${t.titleId}`,
      platform: 'xbox',
      externalId: t.titleId,
      name: t.name,
      ownership: owned && gamepass ? 'both' : owned ? 'owned' : 'gamepass',
      ownershipOverride: null,
      hidden: false,
      installed: false, // affiné via Get-StartApps au moment de la sync
      installDir: null,
      exeHints: [],
      devices: t.devices ?? [],
      playtimeMinutes: 0,
      lastPlayed: t.titleHistory?.lastTimePlayed ? Date.parse(t.titleHistory.lastTimePlayed) : null,
      // jaquette 2:3 du Store en priorité (mieux adaptée aux cartes), sinon l'image titlehub
      coverUrl: art?.poster ?? image,
      heroUrl: art?.hero ?? image,
      storeProductId: direct?.productId || productIdFor(t.name, t.pfn),
      achievementsTotal: achievement.totalAchievements,
      achievementsUnlocked: achievement.currentAchievements,
      dlcOwned: 0,
      dlcTotal: 0,
      updatedAt: Date.now()
    }
    upsertGame(game)
    games.push(game)
  }
  return { games, safeToPrune: !purchased?.partial }
}

/**
 * DLC possédés pour les jeux Xbox : on récupère les add-ons « Durable » du compte
 * et on les rattache à leur jeu par préfixe de titre (les DLC Xbox commencent
 * quasi toujours par le nom du jeu de base). Le total de DLC existants n'étant pas
 * fiable via l'API, on n'affiche que le nombre possédé (« +N DLC »).
 */
export async function syncXboxDlc(games: Game[]): Promise<void> {
  const addons = await fetchOwnedAddons()
  if (addons.length === 0) return
  const xboxGames = games.filter((g) => g.platform === 'xbox')
  // du nom le plus long au plus court → on attache au jeu le plus spécifique
  const byLen = [...xboxGames].sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length)
  const counts = new Map<string, number>()
  for (const addon of addons) {
    const an = normalizeName(addon.title)
    if (an.length < 3) continue
    const base = byLen.find((g) => {
      const gn = normalizeName(g.name)
      return gn.length >= 3 && an.startsWith(gn)
    })
    if (base) counts.set(base.id, (counts.get(base.id) ?? 0) + 1)
  }
  for (const g of xboxGames) setDlcCounts(g.id, counts.get(g.id) ?? 0, 0)
}

interface XblAchievement {
  id: string
  name: string
  description?: string
  lockedDescription?: string
  progressState: string
  progression?: { timeUnlocked?: string }
  mediaAssets?: { name: string; type?: string; url: string }[]
  rarity?: { currentPercentage?: number | string }
}

interface TitleAchievementsResponse {
  achievements?: XblAchievement[]
}

/** Récupère + stocke les succès d'un titre Xbox. Retourne les nouvellement débloqués. */
export async function syncXboxAchievements(titleId: string): Promise<Achievement[]> {
  const auth = await getXboxAccess()
  const gameId = `xbox:${titleId}`
  const data = await xblGet<TitleAchievementsResponse>(
    `https://achievements.xboxlive.com/users/xuid(${auth.xuid})/achievements?titleId=${titleId}&maxItems=1000`
  )
  const list = data.achievements ?? []
  if (list.length === 0) return []

  const achievements: Achievement[] = list.map((a) => {
    const unlocked = a.progressState === 'Achieved'
    const icon = a.mediaAssets?.find((m) => m.name === 'Icon' || m.type === 'Icon')?.url ?? a.mediaAssets?.[0]?.url
    const time = a.progression?.timeUnlocked
    const rarityRaw = a.rarity?.currentPercentage
    return {
      gameId,
      key: a.id,
      name: a.name,
      description: (unlocked ? a.description : a.lockedDescription || a.description) ?? '',
      iconUrl: icon ?? null,
      iconGrayUrl: icon ?? null,
      unlocked,
      // L'API renvoie "0001-01-01…" pour les succès verrouillés
      unlockTime: unlocked && time && !time.startsWith('0001') ? Date.parse(time) : null,
      rarity: rarityRaw != null ? Number(rarityRaw) : null
    }
  })

  return upsertAchievements(gameId, achievements)
}

/**
 * Importe la liste complète des succès Xbox d'un titre — même jamais joué/possédé sur Xbox —
 * dans un jeu possédé sur une autre plateforme (`targetGameId`). Suivi 100 % local et manuel :
 * Microsoft n'a aucune visibilité sur une partie jouée ailleurs que sur Xbox, donc tous les
 * succès sont importés verrouillés (`unlocked: false`) — c'est à l'utilisateur de les cocher
 * lui-même au fil de sa progression. Les clés sont préfixées `xbox-bonus:` pour rester
 * clairement distinctes des vrais succès synchronisés (jamais touchées par une sync normale,
 * jamais confondues avec un vrai déblocage Steam/Xbox).
 */
export async function fetchXboxBonusAchievements(titleId: string, targetGameId: string): Promise<Achievement[]> {
  const auth = await getXboxAccess()
  const data = await xblGet<TitleAchievementsResponse>(
    `https://achievements.xboxlive.com/users/xuid(${auth.xuid})/achievements?titleId=${titleId}&maxItems=1000`
  )
  const list = data.achievements ?? []
  const achievements: Achievement[] = list.map((a) => {
    const icon = a.mediaAssets?.find((m) => m.name === 'Icon' || m.type === 'Icon')?.url ?? a.mediaAssets?.[0]?.url
    const rarityRaw = a.rarity?.currentPercentage
    return {
      gameId: targetGameId,
      key: `xbox-bonus:${a.id}`,
      name: a.name,
      description: (a.lockedDescription || a.description) ?? '',
      iconUrl: icon ?? null,
      iconGrayUrl: icon ?? null,
      unlocked: false,
      unlockTime: null,
      rarity: rarityRaw != null ? Number(rarityRaw) : null
    }
  })
  upsertAchievements(targetGameId, achievements)
  return achievements
}

/**
 * Sync des succès Xbox. On récupère la liste complète des succès pour :
 *  - les jeux INSTALLÉS et ceux déjà JOUÉS (ils peuvent débloquer de nouveaux succès → à rafraîchir) ;
 *  - TOUT jeu qui n'a encore AUCUN succès stocké localement (rattrapage unique — sinon un jeu jamais
 *    installé n'affichait jamais ses succès, alors que c'est tout l'intérêt de l'appli).
 * Les jeux non installés/non joués qui ont déjà leurs succès en base ne sont PAS re-téléchargés à
 * chaque sync (rien de neuf à y gagner) → l'API reste peu sollicitée.
 */
export async function syncAllXboxAchievements(
  games: Game[],
  onProgress: (done: number, total: number, name: string) => void,
  // Déblocages détectés pendant la synchro globale : sans ce relais, ils étaient marqués
  // débloqués en base SANS bannière, et le poller ne voyait ensuite plus rien de neuf →
  // succès « avalés » silencieusement. On les remonte pour que la bannière s'affiche aussi.
  onUnlock?: (game: Game, achievement: Achievement) => void
): Promise<void> {
  // Ne balaye que les jeux réellement INSTALLÉS (et non masqués) : inutile de télécharger les
  // succès d'un jeu Game Pass pas installé ou d'un titre masqué — un jeu y entre dès qu'on
  // l'installe. Les compteurs déjà en base restent (upsert « collant »), on ne les reperd pas.
  const targets = games.filter((g) => g.installed && !g.hidden)
  let done = 0
  const queue = [...targets]
  const workers = Array.from({ length: 3 }, async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      try {
        const newlyUnlocked = await syncXboxAchievements(g.externalId)
        if (onUnlock) for (const a of newlyUnlocked) onUnlock(g, a)
      } catch {
        /* titre sans détail de succès accessible */
      }
      onProgress(++done, targets.length, g.name)
      await new Promise((r) => setTimeout(r, 250))
    }
  })
  await Promise.all(workers)
}

/**
 * Fait apparaître les jeux Xbox/Game Pass présents SUR DISQUE (dossiers XboxGames) mais absents
 * de la base — INDÉPENDAMMENT de l'API Xbox (achat/installation récents, ou API en panne 503).
 * Le `TitleId` du MicrosoftGame.Config est en HEXADÉCIMAL ; l'API et la base utilisent le même
 * identifiant en DÉCIMAL → on convertit pour retomber sur le MÊME id `xbox:<titleId>` (aucun
 * doublon quand l'API récupère enfin le jeu). Le matching se fait aussi par StoreId (fiable).
 * La jaquette et le reste seront enrichis à la prochaine synchro API réussie.
 */
export function syncXboxOnDiskGames(): void {
  const onDisk = scanXboxOnDiskGames()
  if (onDisk.length === 0) return
  const games = getGames().filter((g) => g.platform === 'xbox')
  const byId = new Map(games.map((g) => [g.externalId, g]))
  const byStore = new Map(games.filter((g) => g.storeProductId).map((g) => [String(g.storeProductId).toUpperCase(), g]))
  for (const d of onDisk) {
    if (!d.titleId || !d.storeId) continue
    const titleDec = parseInt(d.titleId, 16) // TitleId config (hex) → décimal (comme l'API)
    if (!Number.isFinite(titleDec) || titleDec <= 0) continue
    const externalId = String(titleDec)
    const existing = byId.get(externalId) ?? byStore.get(d.storeId.toUpperCase())
    if (existing) {
      if (!existing.installed) setGameInstalled(existing.id, true) // déjà en base : juste marquer installé
      continue
    }
    upsertGame({
      id: `xbox:${externalId}`,
      platform: 'xbox',
      externalId,
      name: d.name,
      ownership: 'gamepass',
      installed: true,
      installDir: d.dir,
      exeHints: [],
      devices: ['PC'],
      playtimeMinutes: 0,
      lastPlayed: Date.now(),
      coverUrl: null,
      heroUrl: null,
      storeProductId: d.storeId,
      achievementsTotal: 0,
      achievementsUnlocked: 0,
      dlcOwned: 0,
      dlcTotal: 0
    })
  }
}
