import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { DownloadInfo } from '../../shared/types'

/* ------------------------------------------------------------------ *
 *  Détection des téléchargements Xbox / Game Pass en cours            *
 *                                                                    *
 *  L'appli Xbox n'expose aucune progression fiable (contrairement    *
 *  aux .acf de Steam). Mais pendant un téléchargement, elle crée un   *
 *  dossier au nom d'un GUID sous <lecteur>:\XboxGames\ ; une fois     *
 *  l'installation terminée, ce dossier est renommé avec le vrai nom   *
 *  du jeu. Donc : dossier au nom d'un GUID + Content\MicrosoftGame.   *
 *  Config = jeu en cours de téléchargement.                          *
 *                                                                    *
 *  On lit le StoreId / TitleId / nom dans MicrosoftGame.Config (pour  *
 *  rattacher à la fiche de la bibliothèque) et on somme la taille des *
 *  fichiers du dossier = octets réellement téléchargés (temps réel).  *
 *  La taille TOTALE n'étant pas récupérable de façon fiable, elle est *
 *  saisie par l'utilisateur et persistée ici, par StoreId.           *
 * ------------------------------------------------------------------ */

const GUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/

/** Racines d'installation Xbox : le dossier XboxGames à la racine de chaque lecteur fixe. */
function xboxRoots(): string[] {
  const roots: string[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const p = `${letter}:\\XboxGames`
    try {
      if (existsSync(p)) roots.push(p)
    } catch {
      /* lecteur non prêt — ignore */
    }
  }
  return roots
}

/** Somme récursive de la taille des fichiers d'un dossier (octets déjà écrits sur disque). */
function dirSize(dir: string, budget = { files: 0 }): number {
  let total = 0
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    // garde-fou : on plafonne le nombre de fichiers parcourus pour ne jamais bloquer
    if (budget.files > 200_000) break
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      total += dirSize(full, budget)
    } else if (e.isFile()) {
      budget.files++
      try {
        total += statSync(full).size
      } catch {
        /* fichier verrouillé/disparu en cours de scan — ignore */
      }
    }
  }
  return total
}

/** Extrait StoreId / TitleId / nom depuis un MicrosoftGame.Config. */
function parseGameConfig(configPath: string): { storeId: string | null; titleId: string | null; name: string } | null {
  let xml: string
  try {
    xml = readFileSync(configPath, 'utf-8')
  } catch {
    return null
  }
  const storeId = xml.match(/<StoreId>\s*([^<\s]+)\s*<\/StoreId>/i)?.[1] ?? null
  const titleId = xml.match(/<TitleId>\s*([^<\s]+)\s*<\/TitleId>/i)?.[1] ?? null
  const name =
    xml.match(/DefaultDisplayName\s*=\s*"([^"]+)"/i)?.[1] ??
    xml.match(/OverrideDisplayName\s*=\s*"([^"]+)"/i)?.[1] ??
    'Jeu Xbox'
  return { storeId, titleId, name }
}

export interface XboxOnDiskGame {
  storeId: string
  titleId: string | null
  name: string
  dir: string
}

/**
 * Jeux Xbox présents SUR DISQUE : les dossiers NON-GUID de XboxGames contenant un
 * `Content\MicrosoftGame.Config` (un dossier au nom d'un GUID = téléchargement encore en cours,
 * voir scanXboxDownloads → exclu). Un jeu « sur disque » est soit réellement installé/jouable,
 * soit préchargé (jeu non encore sorti) — la distinction se fait via la date de sortie Store
 * (voir xboxPreload.ts), pas depuis le disque.
 */
export function scanXboxOnDiskGames(): XboxOnDiskGame[] {
  const out: XboxOnDiskGame[] = []
  for (const root of xboxRoots()) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (GUID_RE.test(name)) continue
      const dir = join(root, name)
      const configPath = join(dir, 'Content', 'MicrosoftGame.Config')
      if (!existsSync(configPath)) continue
      const meta = parseGameConfig(configPath)
      if (meta?.storeId) out.push({ storeId: meta.storeId, titleId: meta.titleId, name: meta.name, dir })
    }
  }
  return out
}

/**
 * StoreId (majuscules) → dossier, pour les jeux Xbox présents sur disque. Sert à marquer
 * « installé » de façon FIABLE, par StoreId, là où le matching par nom échoue — ex.
 * « Remnant II® - Standard Edition » en base vs « Remnant2 » au menu Démarrer.
 */
export function scanInstalledXboxStoreIds(): Map<string, string> {
  const out = new Map<string, string>()
  for (const g of scanXboxOnDiskGames()) out.set(g.storeId.toUpperCase(), g.dir)
  return out
}

/* -------------------- taille totale saisie (persistée) -------------------- */

let totalsCache: Record<string, number> | null = null

function totalsPath(): string {
  return join(app.getPath('userData'), 'download-totals.json')
}
function loadTotals(): Record<string, number> {
  if (totalsCache) return totalsCache
  try {
    totalsCache = JSON.parse(readFileSync(totalsPath(), 'utf-8')) as Record<string, number>
  } catch {
    totalsCache = {}
  }
  return totalsCache
}
function saveTotals(): void {
  try {
    writeFileSync(totalsPath(), JSON.stringify(totalsCache ?? {}), 'utf-8')
  } catch {
    /* quota/disque — pas grave, juste pas persisté */
  }
}

/** Mémorise la taille totale (octets) d'un téléchargement, par clé StoreId. 0 = efface. */
export function setDownloadTotal(storeId: string, totalBytes: number): void {
  const t = loadTotals()
  if (totalBytes > 0) t[storeId] = Math.round(totalBytes)
  else delete t[storeId]
  saveTotals()
}

/* -------------------- débit temps réel (mesuré entre deux scans) -------------------- */

/**
 * L'appli Xbox n'expose aucun débit : on le DÉDUIT de la progression du dossier entre
 * deux scans (octets gagnés / temps écoulé), lissé en moyenne mobile exponentielle pour
 * absorber les à-coups d'écriture. Sans ça, une ligne Xbox n'affiche ni vitesse ni temps
 * restant, là où Steam les a — la page Téléchargements paraîtrait à moitié morte.
 */
const samples = new Map<string, { bytes: number; at: number; bps: number }>()

/** Au-delà de ce délai sans le moindre octet écrit, le téléchargement est considéré à l'arrêt. */
const XBOX_STALL_MS = 45_000

/** Débit lissé + état d'arrêt pour un téléchargement Xbox, d'après l'échantillon précédent. */
function rateFor(key: string, bytes: number): { bps: number; paused: boolean } {
  const now = Date.now()
  const prev = samples.get(key)
  if (!prev) {
    samples.set(key, { bytes, at: now, bps: 0 })
    return { bps: 0, paused: false } // premier passage : aucune mesure possible, on ne présume rien
  }
  const dt = now - prev.at
  if (dt < 700) return { bps: prev.bps, paused: false } // scans trop rapprochés → mesure trop bruitée
  const gained = bytes - prev.bytes
  if (gained > 0) {
    const instant = (gained * 1000) / dt
    // lissage : 60 % de l'historique, 40 % de la mesure fraîche
    const bps = prev.bps > 0 ? prev.bps * 0.6 + instant * 0.4 : instant
    samples.set(key, { bytes, at: now, bps })
    return { bps, paused: false }
  }
  // rien de nouveau : on garde la date du dernier octet écrit (prev.at reste inchangé tant
  // que ça ne bouge pas) pour décider au bout de combien de temps c'est vraiment à l'arrêt
  const stalled = now - prev.at > XBOX_STALL_MS
  if (stalled) samples.set(key, { bytes, at: prev.at, bps: 0 })
  return { bps: stalled ? 0 : prev.bps, paused: stalled }
}

/**
 * Liste les jeux Xbox actuellement en cours de téléchargement, avec les octets
 * déjà téléchargés (temps réel) et la taille totale saisie si connue.
 */
export function scanXboxDownloads(): DownloadInfo[] {
  const totals = loadTotals()
  const out: DownloadInfo[] = []
  const seen = new Set<string>()
  for (const root of xboxRoots()) {
    let names: string[]
    try {
      names = readdirSync(root)
    } catch {
      continue
    }
    for (const name of names) {
      if (!GUID_RE.test(name)) continue // seuls les dossiers-GUID = téléchargement en cours
      const dir = join(root, name)
      const configPath = join(dir, 'Content', 'MicrosoftGame.Config')
      if (!existsSync(configPath)) continue
      const meta = parseGameConfig(configPath)
      if (!meta) continue
      const downloadedBytes = dirSize(dir)
      const totalBytes = meta.storeId && totals[meta.storeId] ? totals[meta.storeId] : null
      const { bps, paused } = rateFor(meta.storeId ?? dir, downloadedBytes)
      seen.add(meta.storeId ?? dir)
      out.push({
        platform: 'xbox',
        storeId: meta.storeId,
        titleId: meta.titleId,
        name: meta.name,
        downloadedBytes,
        totalBytes,
        exact: false, // total non exposé par l'appli Xbox → saisi à la main
        paused,
        bytesPerSecond: bps
      })
    }
  }
  // téléchargement fini/annulé → on oublie son échantillon (sinon la reprise repartirait
  // d'un vieux couple octets/date et inventerait un débit délirant)
  for (const key of [...samples.keys()]) if (!seen.has(key)) samples.delete(key)
  return out
}
