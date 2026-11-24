import { openSync, readSync, closeSync, fstatSync, readFileSync, readdirSync, statSync, statfsSync } from 'fs'
import { join } from 'path'
import type { DownloadInfo } from '../../shared/types'
import { getSteamRoot, parseLibraryFolders } from './steam'

/* ------------------------------------------------------------------ *
 *  Détection des téléchargements Steam en cours                       *
 *                                                                    *
 *  Un jeu est « en téléchargement » tant que le bit FullyInstalled(4) *
 *  des StateFlags n'est pas posé et qu'un download est engagé — ça    *
 *  couvre aussi les grosses mises à jour (bit 4 retiré pendant).      *
 *                                                                    *
 *  PROGRESSION : le .acf n'est PAS mis à jour en continu — Steam ne   *
 *  réécrit BytesDownloaded qu'aux changements d'état (démarrage,      *
 *  pause, reprise…), le fichier peut rester figé de longues minutes.  *
 *  (Mesurer le dossier downloading/<appid> ne marche pas non plus :   *
 *  Steam PRÉALLOUE physiquement les fichiers à leur taille finale.)   *
 *  On estime donc en temps réel via logs/content_log.txt :           *
 *    point de synchro (« update started : download A/B ») + débit     *
 *    (« Current download rate: X Mbps », écrit ~toutes les 60 s)      *
 *    → estimé = A + débit × temps écoulé, plafonné, jamais reculant.  *
 * ------------------------------------------------------------------ */

function acfValue(content: string, key: string): string | null {
  return content.match(new RegExp(`"${key}"\\s+"([^"]*)"`))?.[1] ?? null
}

/* -------------------- estimation temps réel via content_log -------------------- */

interface LogInfo {
  /** Lignes de débit (octets/s) dans l'ordre chronologique — une ligne ≈ la minute qui la précède. */
  rates: { at: number; bps: number }[]
  /** Dernier point de synchro par appid : octets téléchargés confirmés + date. */
  syncByApp: Map<string, { bytes: number; at: number }>
  /** Dernier échec bloquant par appid (disque plein, disque en écriture seule…), avec sa date. */
  blockedByApp: Map<string, { reason: string; at: number }>
}

function parseLogDate(s: string): number {
  // "[2026-07-22 20:44:49]" — heure locale de la machine
  const t = new Date(s.replace(' ', 'T')).getTime()
  return Number.isFinite(t) ? t : 0
}

/** Lit la fin de logs/content_log.txt (256 Ko ≈ largement 1 h de log) : débits + points de synchro. */
function readContentLog(steamRoot: string): LogInfo {
  const info: LogInfo = { rates: [], syncByApp: new Map(), blockedByApp: new Map() }
  try {
    const path = join(steamRoot, 'logs', 'content_log.txt')
    const fd = openSync(path, 'r')
    let text: string
    try {
      const size = fstatSync(fd).size
      const len = Math.min(size, 256 * 1024)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, size - len)
      text = buf.toString('utf-8')
    } finally {
      closeSync(fd)
    }

    // débits globaux (une seule file de téléchargement active chez Steam), ordre chronologique
    for (const m of text.matchAll(/\[([^\]]+)\] Current download rate: ([\d.]+) Mbps/g)) {
      info.rates.push({ at: parseLogDate(m[1]), bps: (parseFloat(m[2]) * 1e6) / 8 }) // mégabits/s → octets/s
    }
    // derniers points de synchro par jeu
    for (const m of text.matchAll(/\[([^\]]+)\] AppID (\d+) update started : download (\d+)\/(\d+)/g)) {
      info.syncByApp.set(m[2], { bytes: Number(m[3]), at: parseLogDate(m[1]) })
    }
    // Échecs bloquants : Steam boucle (tentative → échec → pause) sans jamais rien écrire.
    // Ex. « update canceled : Failed to preallocate (Not enough disk space) "35.67 GB" ».
    // Sans cette lecture, l'interface ne peut afficher qu'un 0 % figé, sans en donner la cause.
    for (const m of text.matchAll(/\[([^\]]+)\] AppID (\d+) update canceled : ([^\n\r]+)/g)) {
      info.blockedByApp.set(m[2], { reason: m[3].trim(), at: parseLogDate(m[1]) })
    }
  } catch {
    /* log absent/illisible — on retombera sur le .acf seul */
  }
  return info
}

// Le % affiché ne doit jamais reculer pendant une même session de téléchargement
// (l'estimation peut dépasser un point de synchro qui arrive ensuite plus bas).
const monotonicByApp = new Map<string, number>()

/** Durée maximale couverte par UNE ligne « Current download rate » (elles tombent ~chaque minute). */
const RATE_SEGMENT_CAP = 90_000

/** Meilleure estimation temps réel des octets téléchargés pour un jeu. */
function estimateDownloaded(
  appid: string,
  acfBytes: number,
  acfAt: number,
  toDownload: number,
  log: LogInfo
): number {
  const now = Date.now()
  const sync = log.syncByApp.get(appid)
  // base = la source la plus avancée entre le .acf (à sa date de modif) et le point de synchro du log
  let base = acfBytes
  let baseAt = acfAt
  if (sync && sync.bytes >= acfBytes) {
    base = sync.bytes
    baseAt = sync.at
  }
  // Intégration par paliers : chaque ligne de débit du log couvre ~la minute qui la précède.
  // On additionne débit × durée segment par segment depuis la base, puis on prolonge avec le
  // dernier débit s'il est « frais » (< 3 min — sinon le téléchargement est en pause).
  let estimated = base
  if (baseAt > 0) {
    let cursor = baseAt
    let lastRate: { at: number; bps: number } | null = null
    for (const r of log.rates) {
      if (r.at <= cursor) continue
      // Une ligne de débit ne vaut QUE pour la minute qui la précède : sans ce plafond, le
      // premier relevé après une longue attente (préallocation, file d'attente, jeu en pause)
      // se voyait appliqué à tout l'intervalle écoulé — sur Bodycam, ça inventait ~23 Go
      // « téléchargés » et collait la barre à 99 % dès la première seconde.
      const span = Math.min(r.at - cursor, RATE_SEGMENT_CAP)
      estimated += (r.bps * span) / 1000
      cursor = r.at
      lastRate = r
    }
    if (lastRate && now - lastRate.at < 3 * 60_000 && now > cursor) {
      estimated += (lastRate.bps * Math.min(now - cursor, RATE_SEGMENT_CAP)) / 1000
    }
  }
  // plafonné à 99% du total tant que le .acf n'a pas confirmé la fin
  estimated = Math.min(estimated, acfBytes >= toDownload ? toDownload : toDownload * 0.99)
  // jamais en dessous de ce qu'on a déjà affiché
  const floor = monotonicByApp.get(appid) ?? 0
  const result = Math.max(estimated, acfBytes, floor)
  monotonicByApp.set(appid, result)
  return result
}

/** Traduit le message brut de Steam en une raison lisible, ou null si l'échec n'est pas bloquant. */
function readableBlock(reason: string): string | null {
  if (/not enough disk space/i.test(reason)) {
    const size = reason.match(/"([\d.]+\s*[GMT]B)"/i)?.[1]
    return size ? `Espace disque insuffisant (${size} nécessaires)` : 'Espace disque insuffisant'
  }
  if (/disk write failure|write failure/i.test(reason)) return 'Erreur d’écriture sur le disque'
  if (/disk read failure|read failure/i.test(reason)) return 'Erreur de lecture sur le disque'
  if (/permission|access denied/i.test(reason)) return 'Accès refusé au dossier de téléchargement'
  if (/corrupt/i.test(reason)) return 'Fichiers corrompus — vérifier l’intégrité depuis Steam'
  return null // annulation ordinaire (pause manuelle, arrêt de Steam…) : rien à signaler
}

/**
 * Débit courant en octets/s, ou 0 si le téléchargement est à l'arrêt.
 * Steam écrit « Current download rate » environ toutes les 60 s : au-delà de 3 minutes sans
 * nouvelle ligne, on considère qu'il ne télécharge plus (pause, file d'attente, fin).
 */
function currentRate(log: LogInfo): number {
  const last = log.rates[log.rates.length - 1]
  if (!last || Date.now() - last.at > 3 * 60_000) return 0
  return last.bps
}

/** L'espace libre du disque contenant `dir` suffit-il pour `needed` octets ? */
function hasRoomFor(dir: string, needed: number): boolean {
  try {
    const s = statfsSync(dir)
    return s.bavail * s.bsize >= needed
  } catch {
    return false // impossible de mesurer → on ne masque pas l'alerte
  }
}

/** Liste les jeux Steam en cours de téléchargement, avec progression estimée en temps réel. */
export async function scanSteamDownloads(): Promise<DownloadInfo[]> {
  const out: DownloadInfo[] = []
  const root = await getSteamRoot()
  if (!root) return out
  const log = readContentLog(root)
  const seen = new Set<string>()
  for (const lib of parseLibraryFolders(root)) {
    let files: string[] = []
    try {
      files = readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      try {
        const path = join(lib, f)
        const content = readFileSync(path, 'utf-8')
        const appid = acfValue(content, 'appid')
        const name = acfValue(content, 'name')
        if (!appid || !name) continue
        const stateFlags = Number(acfValue(content, 'StateFlags') ?? 0)
        const toDownload = Number(acfValue(content, 'BytesToDownload') ?? 0)
        const downloaded = Number(acfValue(content, 'BytesDownloaded') ?? 0)
        // téléchargement en cours = pas (encore) totalement installé + download engagé et incomplet
        const downloading = (stateFlags & 4) === 0 && toDownload > 0 && downloaded < toDownload
        if (!downloading) continue
        seen.add(appid)
        const acfAt = statSync(path).mtimeMs
        // StateFlags Steam : 512 = mise à jour EN PAUSE, 1024 = mise à jour démarrée.
        // Un jeu en pause (ou en file d'attente derrière un autre) reste figé — il faut le dire,
        // sinon un « 0 % » immobile passe pour un défaut de l'appli.
        const paused = (stateFlags & 512) !== 0 || (stateFlags & 1024) === 0
        // Le blocage reste pertinent tant que le téléchargement n'a pas repris DEPUIS l'échec :
        // on le compare au dernier démarrage de téléchargement plutôt qu'à l'heure courante.
        // (Un critère « échec récent » ne marche pas : Steam cesse de réessayer, et l'échec peut
        // dater de plusieurs heures alors que le jeu est toujours coincé — cas vu sur un disque plein.)
        const blocked = log.blockedByApp.get(appid)
        const resumedAt = log.syncByApp.get(appid)?.at ?? 0
        const stillBlocked = blocked != null && blocked.at >= resumedAt && downloaded === 0
        let blockedReason = stillBlocked ? readableBlock(blocked!.reason) : null
        // Un « disque plein » n'est plus vrai dès que l'espace a été libéré : on revérifie l'état
        // RÉEL du disque au lieu de laisser un vieil échec du journal alerter à tort.
        if (blockedReason && /disque insuffisant/i.test(blockedReason) && hasRoomFor(lib, toDownload)) {
          blockedReason = null
        }
        out.push({
          platform: 'steam',
          storeId: appid,
          titleId: null,
          name,
          downloadedBytes: Math.round(estimateDownloaded(appid, downloaded, acfAt, toDownload, log)),
          totalBytes: toDownload,
          exact: true,
          paused,
          blockedReason: blockedReason ?? undefined,
          // le débit Steam est global (une seule file active) : on ne l'attribue qu'au jeu
          // réellement en cours de téléchargement, pas à ceux qui attendent leur tour
          bytesPerSecond: paused ? 0 : currentRate(log)
        })
      } catch {
        /* manifeste illisible — ignore */
      }
    }
  }
  // téléchargement terminé/annulé → oublie son plancher monotone (prochaine session repart de zéro)
  for (const appid of [...monotonicByApp.keys()]) {
    if (!seen.has(appid)) monotonicByApp.delete(appid)
  }
  return out
}
