import { useEffect, useRef, useState } from 'react'
import type { DownloadInfo, Game } from '../../../shared/types'

/* ------------------------------------------------------------------ *
 *  Téléchargements en cours — outils partagés (page Téléchargements,  *
 *  fiche de jeu, badges de la bibliothèque).                          *
 * ------------------------------------------------------------------ */

export const GB = 1024 ** 3
const MB = 1024 ** 2

/** Taille lisible : « 820 Mo », « 42,3 Go », « 1,2 To ». */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * GB) return `${(bytes / (1024 * GB)).toFixed(1).replace('.', ',')} To`
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace('.', ',')} Go`
  return `${Math.round(bytes / MB)} Mo`
}

/** Débit lisible en Mo/s (0 → « — »). */
export function formatRate(bps: number): string {
  if (bps <= 0) return '—'
  const mbs = bps / MB
  return `${mbs >= 10 ? Math.round(mbs) : mbs.toFixed(1).replace('.', ',')} Mo/s`
}

/** Durée restante lisible : « 45 s », « 12 min », « 2 h 05 ». */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const h = Math.floor(seconds / 3600)
  return `${h} h ${String(Math.round((seconds % 3600) / 60)).padStart(2, '0')}`
}

export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // enlève les accents
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Jeu de la bibliothèque correspondant à un téléchargement (pour la jaquette et l'ouverture
 * de la fiche). Steam : appid. Xbox : StoreId (fiable), sinon repli sur le nom normalisé.
 */
export function matchGame(d: DownloadInfo, games: Game[]): Game | null {
  if (d.platform === 'steam') {
    return games.find((g) => g.platform === 'steam' && g.externalId === d.storeId) ?? null
  }
  return (
    games.find((g) => g.platform === 'xbox' && d.storeId && g.storeProductId === d.storeId) ??
    games.find((g) => g.platform === 'xbox' && normName(g.name) === normName(d.name)) ??
    null
  )
}

/** Un téléchargement avance-t-il réellement (ni pause, ni blocage) ? */
export function isMoving(d: DownloadInfo): boolean {
  return !d.paused && !d.blockedReason
}

/** Progression 0-100 (une décimale), ou null si la taille totale est inconnue. */
export function pctOf(bytes: number, total: number | null): number | null {
  if (!total || total <= 0) return null
  return Math.min(100, Math.round((bytes / total) * 1000) / 10)
}

/**
 * Sondage des téléchargements actifs. Cadence adaptative : une mesure par seconde tant que
 * quelque chose progresse (les chiffres doivent bouger sous les yeux), 5 s sinon pour ne rien
 * consommer inutilement. `enabled = false` coupe le sondage (page fermée).
 */
export function useActiveDownloads(enabled = true, idleMs = 5000): DownloadInfo[] {
  const [list, setList] = useState<DownloadInfo[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const next = await window.api.getActiveDownloads().catch((): DownloadInfo[] => [])
      if (!alive) return
      setList(next)
      if (alive) timer = setTimeout(() => void poll(), next.some(isMoving) ? 1000 : idleMs)
    }
    void poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [enabled, idleMs])
  return list
}

/**
 * Octets téléchargés PROLONGÉS entre deux mesures : les sources (manifeste Steam, taille du
 * dossier Xbox) ne bougent qu'au rythme du sondage. On extrapole avec le débit courant, ~10 fois
 * par seconde, pour que la barre glisse au lieu d'avancer par à-coups.
 */
export function useSmoothedBytes(dl: DownloadInfo): number {
  const [extra, setExtra] = useState(0)
  const measuredAt = useRef(Date.now())
  useEffect(() => {
    measuredAt.current = Date.now()
    setExtra(0)
  }, [dl.downloadedBytes])
  useEffect(() => {
    const bps = dl.bytesPerSecond ?? 0
    if (bps <= 0 || dl.paused) return
    const id = setInterval(() => setExtra((bps * (Date.now() - measuredAt.current)) / 1000), 100)
    return () => clearInterval(id)
  }, [dl.bytesPerSecond, dl.paused])
  return Math.min(dl.downloadedBytes + extra, dl.totalBytes ?? Infinity)
}
