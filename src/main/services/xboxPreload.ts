import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { PreloadInfo } from '../../shared/types'
import { scanXboxOnDiskGames } from './xboxDownload'
import { getGames } from './db'

/* ------------------------------------------------------------------ *
 *  Jeux Xbox PRÉCHARGÉS (« à venir »)                                 *
 *                                                                    *
 *  Un jeu Game Pass day-one peut être préchargé (fichiers sur disque *
 *  dans XboxGames) AVANT sa sortie : il est enregistré (menu         *
 *  Démarrer) mais pas jouable. Le seul distingueur fiable en local   *
 *  est la DATE DE SORTIE du Store : si elle est dans le futur, le    *
 *  jeu est préchargé et pas encore installé/jouable.                 *
 *                                                                    *
 *  displaycatalog.mp.microsoft.com répond en ANONYME (pas de token)  *
 *  et fournit date de sortie + jaquette. On met en cache par StoreId *
 *  (les dates changent rarement ; TTL court pour qu'un jeu sorti     *
 *  bascule vite hors de « à venir »).                                *
 * ------------------------------------------------------------------ */

interface RelInfo {
  releaseDate: string | null
  coverUrl: string | null
  fetchedAt: number
}

const TTL = 12 * 60 * 60 * 1000 // 12 h
let cache: Record<string, RelInfo> | null = null

function cachePath(): string {
  return join(app.getPath('userData'), 'xbox-release-cache.json')
}
function loadCache(): Record<string, RelInfo> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(cachePath(), 'utf-8')) as Record<string, RelInfo>
  } catch {
    cache = {}
  }
  return cache
}
function saveCache(): void {
  try {
    writeFileSync(cachePath(), JSON.stringify(cache ?? {}), 'utf-8')
  } catch {
    /* quota/disque — pas grave, juste pas persisté */
  }
}

/** Interroge le Store (anonyme) pour la date de sortie + jaquette d'un StoreId, avec cache. */
async function fetchReleaseInfo(storeId: string): Promise<RelInfo> {
  const c = loadCache()
  const hit = c[storeId]
  if (hit && Date.now() - hit.fetchedAt < TTL) return hit
  let info: RelInfo = { releaseDate: null, coverUrl: null, fetchedAt: Date.now() }
  try {
    const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${encodeURIComponent(
      storeId
    )}&market=FR&languages=fr-FR&fieldsTemplate=details`
    const res = await fetch(url, { headers: { 'MS-CV': 'GVpreload.0' } })
    if (res.ok) {
      const j = (await res.json()) as {
        Products?: Array<{
          DisplaySkuAvailabilities?: Array<{ Sku?: { Properties?: { FulfillmentData?: { ReleaseDate?: string } } } }>
          MarketProperties?: Array<{ OriginalReleaseDate?: string }>
          LocalizedProperties?: Array<{ Images?: Array<{ ImagePurpose?: string; Uri?: string }> }>
        }>
      }
      const p = j.Products?.[0]
      if (p) {
        const rel =
          p.DisplaySkuAvailabilities?.[0]?.Sku?.Properties?.FulfillmentData?.ReleaseDate ??
          p.MarketProperties?.[0]?.OriginalReleaseDate ??
          null
        const imgs = p.LocalizedProperties?.[0]?.Images ?? []
        const poster =
          imgs.find((im) => im.ImagePurpose === 'Poster') ?? imgs.find((im) => im.ImagePurpose === 'BoxArt')
        let cover = poster?.Uri ?? null
        if (cover && cover.startsWith('//')) cover = 'https:' + cover
        info = { releaseDate: rel, coverUrl: cover, fetchedAt: Date.now() }
      }
    }
  } catch {
    /* réseau indisponible — best effort, on renvoie l'info vide (non préchargé) */
  }
  c[storeId] = info
  saveCache()
  return info
}

/**
 * true seulement pour une VRAIE date de sortie future. Exclut la sentinelle Microsoft
 * « 9998-12-30 » (= date non annoncée) : un jeu à date inconnue reste traité comme normal, on ne
 * veut pas retirer de « Installés » un preview jouable dont la sortie n'est simplement pas datée.
 */
function isConcreteFuture(dateStr: string | null): boolean {
  if (!dateStr) return false
  const t = Date.parse(dateStr)
  if (Number.isNaN(t)) return false
  if (new Date(t).getUTCFullYear() >= 9000) return false
  return t > Date.now()
}

/**
 * Liste les jeux Xbox préchargés : présents sur disque mais dont la date de sortie Store est dans
 * le futur (pas encore jouables). Inclut ceux hors bibliothèque (Game Pass day-one non publié).
 */
export async function scanXboxPreloads(): Promise<PreloadInfo[]> {
  const onDisk = scanXboxOnDiskGames()
  if (onDisk.length === 0) return []
  const games = getGames()
  const byStore = new Map<string, string>() // StoreId (maj) → gameId en bibliothèque
  for (const g of games) {
    if (g.platform === 'xbox' && g.storeProductId) byStore.set(g.storeProductId.toUpperCase(), g.id)
  }
  const out: PreloadInfo[] = []
  // séquentiel : petite liste, et évite les écritures concurrentes du cache disque
  for (const d of onDisk) {
    const info = await fetchReleaseInfo(d.storeId)
    if (!isConcreteFuture(info.releaseDate)) continue // sorti / date inconnue → pas un préload
    const gameId = byStore.get(d.storeId.toUpperCase()) ?? null
    const dbGame = gameId ? games.find((g) => g.id === gameId) : null
    out.push({
      storeId: d.storeId,
      titleId: d.titleId,
      name: dbGame?.name ?? d.name,
      coverUrl: dbGame?.coverUrl ?? info.coverUrl,
      releaseDate: info.releaseDate,
      gameId
    })
  }
  return out
}
