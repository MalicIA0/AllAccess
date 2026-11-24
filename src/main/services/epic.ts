import { existsSync, readdirSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import type { Game } from '../../shared/types'
import { getEpicAccess } from './epicAuth'
import { setDlcCounts, upsertGame } from './db'

/**
 * Bibliothèque Epic Games du compte connecté.
 * 1) liste des items possédés (library-service, paginée)
 * 2) métadonnées catalogue par namespace (titres, jaquettes, catégories jeu/DLC)
 * 3) état « installé » via les manifestes locaux du launcher (ProgramData)
 * 4) DLC possédés rattachés à leur jeu de base (mêmes namespaces / mainGameItem)
 */

const LIBRARY_URL = 'https://library-service.live.use1a.on.epicgames.com/library/api/public/items'
const CATALOG_BASE = 'https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared'

interface LibraryRecord {
  namespace: string
  catalogItemId: string
  appName: string
}

interface KeyImage {
  type: string
  url: string
}
interface CatalogItem {
  title: string
  keyImages?: KeyImage[]
  categories?: { path: string }[]
  mainGameItem?: { id: string; namespace: string }
}

async function fetchOwnedRecords(token: string): Promise<LibraryRecord[]> {
  const records: LibraryRecord[] = []
  let cursor: string | null = null
  do {
    const url = new URL(LIBRARY_URL)
    url.searchParams.set('includeMetadata', 'false')
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url, {
      headers: { Authorization: `bearer ${token}` },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) throw new Error(`Epic library → HTTP ${res.status}`)
    const data = (await res.json()) as {
      records?: LibraryRecord[]
      responseMetadata?: { nextCursor?: string }
    }
    records.push(...(data.records ?? []))
    cursor = data.responseMetadata?.nextCursor ?? null
  } while (cursor)
  return records
}

/**
 * Métadonnées catalogue, requêtées par namespace (l'endpoint est scindé par namespace).
 * `partial` indique qu'au moins un lot a échoué — la map est alors incomplète, un item réellement
 * possédé (via `records`, résolu séparément et de façon fiable) peut y manquer sans être pour
 * autant plus possédé : l'appelant doit s'abstenir de purger la base dans ce cas.
 */
async function fetchCatalog(
  token: string,
  byNamespace: Map<string, string[]>
): Promise<{ map: Map<string, CatalogItem>; partial: boolean }> {
  const out = new Map<string, CatalogItem>() // catalogItemId → item
  let partial = false
  const namespaces = [...byNamespace.entries()]
  const queue = [...namespaces]
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const [ns, ids] = entry
        // l'endpoint accepte plusieurs id= par requête, on lotit par 50
        for (let i = 0; i < ids.length; i += 50) {
          const url = new URL(`${CATALOG_BASE}/namespace/${ns}/bulk/items`)
          for (const id of ids.slice(i, i + 50)) url.searchParams.append('id', id)
          url.searchParams.set('country', 'FR')
          url.searchParams.set('locale', 'fr')
          url.searchParams.set('includeMainGameDetails', 'true')
          try {
            const res = await fetch(url, {
              headers: { Authorization: `bearer ${token}` },
              signal: AbortSignal.timeout(20_000)
            })
            if (!res.ok) {
              partial = true
              continue
            }
            const data = (await res.json()) as Record<string, CatalogItem>
            for (const [cid, item] of Object.entries(data)) out.set(cid, item)
          } catch {
            partial = true
            /* lot en échec — on continue */
          }
        }
      }
    })
  )
  return { map: out, partial }
}

function pickImage(images: KeyImage[] | undefined, types: string[]): string | null {
  if (!images) return null
  for (const t of types) {
    const m = images.find((i) => i.type === t && i.url)
    if (m) return m.url
  }
  return images[0]?.url ?? null
}

function hasCategory(item: CatalogItem, path: string): boolean {
  return (item.categories ?? []).some((c) => c.path === path)
}

interface EpicManifest {
  catalogItemId: string
  appName: string
  installLocation: string
  launchExecutable: string
}

/** Manifestes des jeux Epic installés localement (aucune connexion requise). */
function readEpicManifests(): EpicManifest[] {
  const dir = join(
    process.env.PROGRAMDATA || 'C:\\ProgramData',
    'Epic',
    'EpicGamesLauncher',
    'Data',
    'Manifests'
  )
  if (!existsSync(dir)) return []
  const out: EpicManifest[] = []
  try {
    for (const f of readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.item'))) {
      try {
        const m = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as {
          CatalogItemId?: string
          AppName?: string
          InstallLocation?: string
          LaunchExecutable?: string
        }
        if (!m.CatalogItemId && !m.AppName) continue
        out.push({
          catalogItemId: m.CatalogItemId ?? '',
          appName: m.AppName ?? '',
          installLocation: m.InstallLocation ?? '',
          launchExecutable: m.LaunchExecutable ?? ''
        })
      } catch {
        /* manifeste illisible */
      }
    }
  } catch {
    /* dossier inaccessible */
  }
  return out
}

/**
 * Récupère la bibliothèque Epic complète et l'enregistre en base.
 * Les DLC possédés sont comptés et rattachés à leur jeu de base.
 * `safeToPrune` est faux si la résolution du catalogue a partiellement échoué (voir `fetchCatalog`).
 */
export async function fetchEpicLibrary(): Promise<{ games: Game[]; safeToPrune: boolean }> {
  const { token } = await getEpicAccess()
  const records = await fetchOwnedRecords(token)
  if (records.length === 0) return { games: [], safeToPrune: true }

  const byNamespace = new Map<string, string[]>()
  for (const r of records) {
    const arr = byNamespace.get(r.namespace) ?? []
    arr.push(r.catalogItemId)
    byNamespace.set(r.namespace, arr)
  }
  const { map: catalog, partial } = await fetchCatalog(token, byNamespace)

  const manifests = readEpicManifests()
  const manifestByCid = new Map(manifests.filter((m) => m.catalogItemId).map((m) => [m.catalogItemId, m]))
  const manifestByApp = new Map(manifests.filter((m) => m.appName).map((m) => [m.appName, m]))

  // 1re passe : distingue jeux de base et DLC possédés
  const baseRecords: { r: LibraryRecord; item: CatalogItem }[] = []
  const ownedAddons: { r: LibraryRecord; item: CatalogItem }[] = []
  for (const r of records) {
    const item = catalog.get(r.catalogItemId)
    if (!item) continue
    // on ignore le moteur Unreal, les applications et extras non-jeu
    if (hasCategory(item, 'engines') || hasCategory(item, 'applications')) continue
    if (hasCategory(item, 'addons')) {
      ownedAddons.push({ r, item })
    } else if (hasCategory(item, 'games')) {
      baseRecords.push({ r, item })
    }
  }

  // rattache chaque DLC possédé à un jeu de base (par mainGameItem, sinon par namespace)
  const dlcCountByCid = new Map<string, number>()
  const baseByNamespace = new Map<string, string[]>() // namespace → [catalogItemId de base]
  for (const { r } of baseRecords) {
    const arr = baseByNamespace.get(r.namespace) ?? []
    arr.push(r.catalogItemId)
    baseByNamespace.set(r.namespace, arr)
  }
  for (const { r, item } of ownedAddons) {
    let baseCid = item.mainGameItem?.id ?? null
    if (!baseCid) {
      const inNs = baseByNamespace.get(r.namespace)
      if (inNs && inNs.length === 1) baseCid = inNs[0] // namespace sans ambiguïté
    }
    if (baseCid) dlcCountByCid.set(baseCid, (dlcCountByCid.get(baseCid) ?? 0) + 1)
  }

  const games: Game[] = []
  for (const { r, item } of baseRecords) {
    const manifest = manifestByCid.get(r.catalogItemId) ?? manifestByApp.get(r.appName)
    const installed = !!manifest && !!manifest.installLocation && existsSync(manifest.installLocation)
    const exe = manifest?.launchExecutable ? basename(manifest.launchExecutable).toLowerCase() : null
    const dlcOwned = dlcCountByCid.get(r.catalogItemId) ?? 0
    const game: Game = {
      id: `epic:${r.appName}`,
      platform: 'epic',
      externalId: r.appName,
      name: item.title,
      ownership: 'owned',
      ownershipOverride: null,
      hidden: false,
      installed,
      installDir: manifest?.installLocation || null,
      exeHints: exe ? [exe] : [],
      devices: ['PC'],
      playtimeMinutes: 0,
      lastPlayed: null,
      coverUrl: pickImage(item.keyImages, ['DieselStoreFrontTall', 'OfferImageTall', 'Thumbnail']),
      heroUrl: pickImage(item.keyImages, ['DieselStoreFrontWide', 'OfferImageWide', 'DieselGameBoxWide']),
      // triple namespace:catalogItemId:appName — sert à l'URI d'installation du launcher
      storeProductId: `${r.namespace}:${r.catalogItemId}:${r.appName}`,
      achievementsTotal: 0,
      achievementsUnlocked: 0,
      dlcOwned,
      dlcTotal: 0, // total inconnu côté Epic → affichage « +N DLC »
      updatedAt: Date.now()
    }
    upsertGame(game)
    setDlcCounts(game.id, dlcOwned, 0)
    games.push(game)
  }
  return { games, safeToPrune: !partial }
}
