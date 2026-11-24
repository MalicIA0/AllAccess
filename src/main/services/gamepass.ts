import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Catalogue Game Pass public (mêmes endpoints que le site xbox.com).
 * PC Game Pass + Console Game Pass, mis en cache 24 h sur disque.
 */

const SIGL_PC = 'fdd9e2a7-0fee-49f6-ad69-4354098401ff' // PC Game Pass
const SIGL_CONSOLE = 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e' // Console Game Pass
// Collection officielle Xbox « Ajouts récents » (même source que le tri par défaut de
// xbox.com/xbox-game-pass/games) — les vrais derniers jeux offerts par l'abonnement, dans
// l'ordre d'ajout, pas un proxy de fraîcheur de fiche.
const SIGL_RECENT = '3fdd7f57-7092-4b65-bd40-5a9dac1b2b84'

export interface StoreArt {
  poster: string | null
  hero: string | null
}

export interface ResolvedProduct {
  productId: string
  title: string
  pfn: string | null
  art: StoreArt
}

export interface CatalogEntry {
  productId: string
  title: string
  poster: string | null
  hero: string | null
  pfn: string | null
  pc: boolean
  console: boolean
}

interface CatalogCache {
  fetchedAt: number
  names: string[]
  pfns: string[]
  /** Visuels du Store, indexés par nom normalisé ET par PFN minuscule */
  art: Record<string, StoreArt>
  /** ProductId Microsoft Store, mêmes clés que `art` */
  productIds: Record<string, string>
  /** Catalogue complet (page Game Pass) */
  entries: CatalogEntry[]
  /** Derniers jeux ajoutés au Game Pass (collection officielle Xbox), du plus récent au plus ancien */
  recent: CatalogEntry[]
}

let memCache: CatalogCache | null = null

function cachePath(): string {
  return join(app.getPath('userData'), 'gamepass-catalog.json')
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\b(pc|windows|edition|deluxe|standard|ultimate|game preview|for windows)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

interface DcImage {
  ImagePurpose?: string
  Uri?: string
}

function httpsUri(uri: string): string {
  if (uri.startsWith('//')) return `https:${uri}`
  return uri.replace(/^http:\/\//, 'https://')
}

function pickImage(images: DcImage[], purposes: string[]): string | null {
  for (const p of purposes) {
    const m = images.find((i) => i.ImagePurpose === p && i.Uri)
    if (m?.Uri) return httpsUri(m.Uri)
  }
  return null
}

interface DcAlternateId {
  IdType?: string
  Value?: string
}

interface DcProduct {
  ProductId?: string
  LocalizedProperties?: { ProductTitle?: string; Images?: DcImage[] }[]
  Properties?: { PackageFamilyName?: string }
  AlternateIds?: DcAlternateId[]
}

function dcProductToResolved(p: DcProduct): ResolvedProduct | null {
  const loc = p.LocalizedProperties?.[0]
  const title = loc?.ProductTitle
  if (!title) return null
  const images = loc?.Images ?? []
  return {
    productId: p.ProductId ?? '',
    title,
    pfn: p.Properties?.PackageFamilyName ?? null,
    art: {
      // Poster = format 2:3, idéal pour les cartes de la bibliothèque
      poster: pickImage(images, ['Poster', 'BoxArt', 'BrandedKeyArt', 'TitledHeroArt', 'SuperHeroArt']),
      hero: pickImage(images, ['SuperHeroArt', 'TitledHeroArt', 'BrandedKeyArt', 'Poster', 'BoxArt'])
    }
  }
}

/**
 * Résout des productIds du Microsoft Store en titres + PFN + visuels (jaquette/bannière).
 * `partial` indique qu'au moins un lot a échoué (timeout/réseau) — dans ce cas la liste retournée
 * est incomplète et les appelants qui s'en servent pour décider quoi purger de la base doivent
 * s'abstenir de purger (mieux vaut garder un jeu en trop qu'en supprimer un possédé à tort).
 */
export async function resolveProducts(ids: string[]): Promise<{ products: ResolvedProduct[]; partial: boolean }> {
  const products: ResolvedProduct[] = []
  let partial = false
  // displaycatalog accepte ~20 bigIds par requête — pour un catalogue Game Pass (800+ jeux) ça
  // fait des dizaines de lots : on les envoie en parallèle (par groupes de 5) plutôt qu'un par un,
  // ce qui divise le temps de résolution par ~5 (surtout sensible au premier lancement ou quand
  // le cache disque de 24h a expiré).
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 20) batches.push(ids.slice(i, i + 20))
  const CONCURRENCY = 5
  const queue = [...batches]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) {
        try {
          const res = await fetch(
            `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${batch.join(',')}&market=FR&languages=fr-fr,neutral&MS-CV=gamevault`,
            { signal: AbortSignal.timeout(20_000) }
          )
          if (!res.ok) {
            partial = true
            continue
          }
          const data = (await res.json()) as { Products?: DcProduct[] }
          for (const p of data.Products ?? []) {
            const resolved = dcProductToResolved(p)
            if (resolved) products.push(resolved)
          }
        } catch {
          partial = true
          /* lot en échec — on continue */
        }
      }
    })
  )
  return { products, partial }
}

const titleIdCache = new Map<string, ResolvedProduct | null>()

/**
 * Résout un jeu Xbox directement par son titleId (bien plus fiable que le
 * matching par nom, qui échoue sur les accents/sous-titres/éditions).
 */
export async function resolveByXboxTitleId(titleId: string): Promise<ResolvedProduct | null> {
  if (titleIdCache.has(titleId)) return titleIdCache.get(titleId) ?? null
  try {
    const res = await fetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?market=FR&languages=fr-fr,neutral&alternateId=XboxTitleId&value=${titleId}&MS-CV=gamevault`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) {
      titleIdCache.set(titleId, null)
      return null
    }
    const data = (await res.json()) as { Products?: DcProduct[] }
    const resolved = data.Products?.[0] ? dcProductToResolved(data.Products[0]) : null
    titleIdCache.set(titleId, resolved)
    return resolved
  } catch {
    titleIdCache.set(titleId, null)
    return null
  }
}

/** Liste ordonnée d'ids d'une collection (l'ordre compte pour « Ajouts récents »). */
async function fetchSiglIds(sigl: string): Promise<string[]> {
  const res = await fetch(`https://catalog.gamepass.com/sigls/v2?id=${sigl}&language=fr-fr&market=FR`, {
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) return []
  const arr = (await res.json()) as { id?: string }[]
  return arr.filter((item): item is { id: string } => !!item.id).map((item) => item.id)
}

async function fetchSigl(sigl: string): Promise<Set<string>> {
  return new Set(await fetchSiglIds(sigl))
}

async function fetchCatalog(): Promise<CatalogCache> {
  const pcIds = await fetchSigl(SIGL_PC).catch(() => new Set<string>())
  const consoleIds = await fetchSigl(SIGL_CONSOLE).catch(() => new Set<string>())
  const recentIds = await fetchSiglIds(SIGL_RECENT).catch(() => [] as string[])
  const productIds = new Set([...pcIds, ...consoleIds, ...recentIds])

  const { products } = await resolveProducts([...productIds])
  const names: string[] = []
  const pfns: string[] = []
  const art: Record<string, StoreArt> = {}
  const productIdsByKey: Record<string, string> = {}
  const entries: CatalogEntry[] = []
  const entryByProductId = new Map<string, CatalogEntry>()
  for (const p of products) {
    const n = normalizeName(p.title)
    names.push(n)
    art[n] = p.art
    if (p.productId) productIdsByKey[n] = p.productId
    if (p.pfn) {
      pfns.push(p.pfn.toLowerCase())
      art[p.pfn.toLowerCase()] = p.art
      if (p.productId) productIdsByKey[p.pfn.toLowerCase()] = p.productId
    }
    if (p.productId) {
      const entry: CatalogEntry = {
        productId: p.productId,
        title: p.title,
        poster: p.art.poster,
        hero: p.art.hero,
        pfn: p.pfn,
        pc: pcIds.has(p.productId),
        console: consoleIds.has(p.productId)
      }
      entries.push(entry)
      entryByProductId.set(p.productId, entry)
    }
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
  // reconstitue l'ordre officiel « Ajouts récents » (le plus récent d'abord)
  const recent = recentIds
    .map((id) => entryByProductId.get(id))
    .filter((e): e is CatalogEntry => !!e)
  return {
    fetchedAt: Date.now(),
    names: [...new Set(names)],
    pfns: [...new Set(pfns)],
    art,
    productIds: productIdsByKey,
    entries,
    recent
  }
}

function readDiskCache(): CatalogCache | null {
  if (!existsSync(cachePath())) return null
  try {
    const disk = JSON.parse(readFileSync(cachePath(), 'utf-8')) as CatalogCache
    // ancien format sans visuels/productIds/entries/recent → on force un re-fetch
    if (!disk.art || !disk.productIds || !disk.entries || !disk.recent) return null
    return disk
  } catch {
    return null
  }
}

export async function getGamePassCatalog(): Promise<CatalogCache> {
  if (memCache && Date.now() - memCache.fetchedAt < 86_400_000) return memCache
  const disk = readDiskCache()
  if (disk && Date.now() - disk.fetchedAt < 86_400_000) {
    memCache = disk
    return disk
  }
  const fresh = await fetchCatalog()
  // Si le fetch a échoué (réseau), garde l'ancien cache disque plutôt qu'un catalogue vide
  if (fresh.names.length === 0 && disk) {
    memCache = disk
    return disk
  }
  writeFileSync(cachePath(), JSON.stringify(fresh), 'utf-8')
  memCache = fresh
  return fresh
}

/** Catalogue complet trié (page Game Pass). Liste vide en cas d'échec réseau sans cache. */
export async function getGamePassEntries(): Promise<CatalogEntry[]> {
  try {
    return (await getGamePassCatalog()).entries ?? []
  } catch {
    return []
  }
}

/** Derniers jeux ajoutés au Game Pass (collection officielle Xbox « Ajouts récents »). */
export async function getGamePassRecent(): Promise<CatalogEntry[]> {
  try {
    return (await getGamePassCatalog()).recent ?? []
  } catch {
    return []
  }
}

/** Un titre Xbox est-il actuellement dans le Game Pass ? (match par PFN puis par nom normalisé) */
export async function isOnGamePass(name: string, pfn?: string): Promise<boolean> {
  try {
    const catalog = await getGamePassCatalog()
    if (pfn && catalog.pfns.includes(pfn.toLowerCase())) return true
    return catalog.names.includes(normalizeName(name))
  } catch {
    return false
  }
}

/**
 * Extrait un productId Microsoft Store (12 caractères, ex. "9NWQ1Q1FR0C9") d'un lien Xbox/Store
 * collé par l'utilisateur, ou accepte l'identifiant brut directement.
 */
export function extractProductId(input: string): string | null {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/([A-Z0-9]{12})(?:[/?#]|$)/i)
  if (urlMatch) return urlMatch[1].toUpperCase()
  if (/^[A-Z0-9]{12}$/i.test(trimmed)) return trimmed.toUpperCase()
  return null
}

/**
 * Résout le titleId Xbox Live (utilisé par achievements.xboxlive.com) correspondant à un
 * productId Microsoft Store — présent dans les AlternateIds du catalogue, indépendamment de
 * toute possession/historique de jeu sur Xbox. Sert à importer la liste de succès Xbox d'un
 * jeu possédé sur une autre plateforme (suivi manuel, jamais synchronisé avec le vrai compte).
 */
export async function resolveXboxTitleId(productId: string): Promise<{ titleId: string; title: string } | null> {
  try {
    const res = await fetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=FR&languages=fr-fr,neutral&MS-CV=gamevault`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) return null
    const data = (await res.json()) as { Products?: DcProduct[] }
    const p = data.Products?.[0]
    const title = p?.LocalizedProperties?.[0]?.ProductTitle
    const titleId = p?.AlternateIds?.find((a) => a.IdType === 'XboxTitleId')?.Value
    if (!title || !titleId) return null
    return { titleId, title }
  } catch {
    return null
  }
}
