import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DiskInfo, DownloadInfo, Game } from '../../../shared/types'
import { PlatformBadge } from '../components/GameCard'
import {
  GB,
  formatEta,
  formatRate,
  formatSize,
  isMoving,
  matchGame,
  pctOf,
  useActiveDownloads,
  useSmoothedBytes
} from '../lib/downloads'

/** Clé stable d'un téléchargement (même convention que le main : plateforme + identifiant). */
const keyOf = (d: DownloadInfo): string => `${d.platform}:${d.storeId ?? d.name}`

/* ------------------------------- pastille d'état ------------------------------- */

function StatusChip({ dl }: { dl: DownloadInfo }): React.JSX.Element {
  if (dl.blockedReason)
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-bold text-red-400">
        ⚠ {dl.blockedReason}
      </span>
    )
  if (dl.paused)
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-400">
        ⏸ En pause
      </span>
    )
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-vault-accent2/15 px-2.5 py-0.5 text-[11px] font-bold text-vault-accent2">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-vault-accent2 shadow-[0_0_8px_currentColor]" />
      En cours
    </span>
  )
}

/* ------------------------------- une ligne ------------------------------- */

function DownloadRow({
  dl,
  game,
  onSelect
}: {
  dl: DownloadInfo
  game: Game | null
  onSelect: (id: string) => void
}): React.JSX.Element {
  const shown = useSmoothedBytes(dl)
  const pct = pctOf(shown, dl.totalBytes)
  const bps = dl.paused ? 0 : (dl.bytesPerSecond ?? 0)
  const remaining = dl.totalBytes != null ? Math.max(0, dl.totalBytes - shown) : null
  const eta = bps > 0 && remaining != null ? remaining / bps : null

  // Taille totale Xbox : non exposée par l'appli Xbox → saisie à la main, persistée par StoreId.
  const [editing, setEditing] = useState(!dl.exact && dl.totalBytes == null)
  const [gbInput, setGbInput] = useState(dl.totalBytes != null ? (dl.totalBytes / GB).toFixed(1) : '')
  const saveTotal = async (): Promise<void> => {
    if (!dl.storeId) return
    const gb = parseFloat(gbInput.replace(',', '.'))
    await window.api.setDownloadTotal(dl.storeId, Number.isFinite(gb) && gb > 0 ? gb * GB : 0)
    setEditing(false)
  }

  const cover = game?.coverUrl ?? null
  const moving = isMoving(dl)

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'tween', duration: 0.18, ease: 'easeOut' }}
      className="glass relative overflow-hidden rounded-2xl border border-vault-border p-4"
    >
      {/* liseré d'accent à gauche, éteint quand ça n'avance pas */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${
          dl.blockedReason
            ? 'bg-red-500'
            : dl.paused
              ? 'bg-amber-400'
              : 'bg-gradient-to-b from-vault-accent to-vault-accent2'
        }`}
      />
      <div className="flex gap-4">
        {/* jaquette — cliquable pour ouvrir la fiche du jeu */}
        <button
          type="button"
          disabled={!game}
          onClick={() => game && onSelect(game.id)}
          title={game ? `Ouvrir la fiche de ${game.name}` : undefined}
          className="h-[108px] w-[72px] shrink-0 overflow-hidden rounded-xl border border-vault-border bg-vault-panel transition enabled:hover:border-vault-accent/50 enabled:hover:shadow-lg enabled:hover:shadow-vault-accent/20 disabled:cursor-default"
        >
          {cover ? (
            <img src={cover} alt={dl.name} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-2xl text-vault-muted">🎮</span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!game}
              onClick={() => game && onSelect(game.id)}
              className="truncate text-base font-black tracking-tight text-vault-text transition enabled:hover:text-vault-accent2 disabled:cursor-default"
            >
              {game?.name ?? dl.name}
            </button>
            <PlatformBadge platform={dl.platform} />
            <StatusChip dl={dl} />
          </div>

          {/* barre de progression */}
          <div className="mt-3 flex items-center gap-3">
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/10">
              {pct != null ? (
                <motion.div
                  className={`relative h-full overflow-hidden rounded-full ${
                    dl.blockedReason
                      ? 'bg-red-500/70'
                      : dl.paused
                        ? 'bg-amber-400/70'
                        : 'bg-gradient-to-r from-vault-accent to-vault-accent2'
                  } ${moving ? 'dl-flow' : ''}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.15, ease: 'linear' }}
                />
              ) : (
                // total inconnu (Xbox sans saisie) : va-et-vient, on ne peut pas afficher de %
                <div className="dl-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-vault-accent to-vault-accent2" />
              )}
            </div>
            <span className="w-14 shrink-0 text-right text-sm font-black tabular-nums text-vault-text">
              {pct != null ? `${Math.floor(pct)}%` : '—'}
            </span>
          </div>

          {/* chiffres : téléchargé / total · débit · temps restant */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums">
            <span className="text-vault-muted">
              <span className="font-bold text-vault-text">{formatSize(shown)}</span>
              {dl.totalBytes != null && ` / ${formatSize(dl.totalBytes)}`}
            </span>
            {bps > 0 && <span className="font-bold text-vault-accent2">{formatRate(bps)}</span>}
            {eta != null && <span className="text-vault-muted">reste {formatEta(eta)}</span>}
            {remaining != null && !dl.paused && (
              <span className="text-vault-muted">{formatSize(remaining)} restants</span>
            )}
            {!dl.exact && (
              <button
                onClick={() => setEditing((v) => !v)}
                className="ml-auto font-semibold text-vault-muted underline-offset-2 transition hover:text-vault-text hover:underline"
              >
                {dl.totalBytes ? 'Modifier la taille' : 'Définir la taille totale'}
              </button>
            )}
          </div>

          {editing && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-xs text-vault-muted">
                Taille totale annoncée par l’appli Xbox&nbsp;:
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={gbInput}
                onChange={(e) => setGbInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveTotal()}
                placeholder="ex. 130"
                className="w-24 rounded-lg border border-vault-border bg-vault-card px-2 py-1 text-sm outline-none focus:border-vault-accent/50"
              />
              <span className="text-xs text-vault-muted">Go</span>
              <button
                onClick={() => void saveTotal()}
                className="rounded-lg bg-vault-accent/80 px-3 py-1 text-xs font-bold text-white transition hover:bg-vault-accent"
              >
                Enregistrer
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.li>
  )
}

/* ------------------------------- espace disque ------------------------------- */

function DiskChips({ disks }: { disks: DiskInfo[] }): React.JSX.Element | null {
  if (disks.length === 0) return null
  const fmt = (gb: number): string => (gb >= 1024 ? `${(gb / 1024).toFixed(1).replace('.', ',')} To` : `${Math.round(gb)} Go`)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {disks.map((d) => {
        const pct = d.totalGb > 0 ? Math.min(100, (d.usedGb / d.totalGb) * 100) : 0
        const low = d.freeGb < 25
        return (
          <div
            key={d.drive}
            title={`${d.drive} — ${fmt(d.usedGb)} utilisés sur ${fmt(d.totalGb)}`}
            className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs"
          >
            <span className="font-bold text-vault-muted">💾 {d.drive}</span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${low ? 'bg-red-500' : 'bg-gradient-to-r from-vault-accent to-vault-accent2'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`tabular-nums ${low ? 'font-bold text-red-400' : 'text-vault-muted'}`}>
              {fmt(d.freeGb)} libres
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------- la page ------------------------------- */

interface Finished {
  key: string
  name: string
  coverUrl: string | null
  at: number
}

export default function Downloads({
  games,
  onSelect
}: {
  games: Game[]
  onSelect: (id: string) => void
}): React.JSX.Element {
  const downloads = useActiveDownloads()

  // Espace disque : un téléchargement qui cale, c'est presque toujours le disque.
  const [disks, setDisks] = useState<DiskInfo[]>([])
  useEffect(() => {
    const load = (): void => void window.api.getDiskUsage().then(setDisks)
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [])

  // Terminés PENDANT que la page est ouverte : sans ça, une ligne disparaît sans rien dire
  // et on ne sait pas si le téléchargement a fini ou s'il a planté.
  const [finished, setFinished] = useState<Finished[]>([])
  const prevKeys = useRef<Map<string, Finished>>(new Map())
  useEffect(() => {
    const current = new Map<string, Finished>()
    for (const d of downloads) {
      const g = matchGame(d, games)
      current.set(keyOf(d), { key: keyOf(d), name: g?.name ?? d.name, coverUrl: g?.coverUrl ?? null, at: 0 })
    }
    const gone = [...prevKeys.current.values()].filter((f) => !current.has(f.key))
    if (gone.length > 0) {
      setFinished((prev) => [...gone.map((f) => ({ ...f, at: Date.now() })), ...prev].slice(0, 8))
    }
    prevKeys.current = current
  }, [downloads, games])

  const totals = useMemo(() => {
    const moving = downloads.filter(isMoving)
    const bps = moving.reduce((s, d) => s + (d.bytesPerSecond ?? 0), 0)
    let remaining = 0
    let unknown = 0
    for (const d of downloads) {
      if (d.totalBytes != null) remaining += Math.max(0, d.totalBytes - d.downloadedBytes)
      else unknown++
    }
    return { count: downloads.length, movingCount: moving.length, bps, remaining, unknown }
  }, [downloads])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Téléchargements</h1>
          <p className="mt-1 text-sm text-vault-muted">
            {totals.count === 0
              ? 'Rien en cours — cette page se met à jour toute seule.'
              : `${totals.count} en cours${totals.movingCount < totals.count ? ` · ${totals.count - totals.movingCount} à l’arrêt` : ''} · Steam et Xbox suivis en direct`}
          </p>
        </div>
        <DiskChips disks={disks} />
      </div>

      {/* Bandeau récapitulatif : débit cumulé, reste à télécharger, temps restant global */}
      <AnimatePresence>
        {totals.count > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-vault-accent/25 bg-vault-accent/5 px-5 py-4"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-vault-muted">Débit total</p>
              <p className="text-2xl font-black tabular-nums text-vault-accent2">{formatRate(totals.bps)}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-vault-muted">Reste à télécharger</p>
              <p className="text-2xl font-black tabular-nums">
                {formatSize(totals.remaining)}
                {totals.unknown > 0 && <span className="text-sm font-bold text-vault-muted"> + {totals.unknown} inconnu(s)</span>}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-vault-muted">Temps restant</p>
              <p className="text-2xl font-black tabular-nums">
                {totals.bps > 0 && totals.remaining > 0 ? formatEta(totals.remaining / totals.bps) : '—'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {totals.count === 0 && finished.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <p className="text-6xl">⬇</p>
          <h2 className="text-xl font-bold">Aucun téléchargement en cours</h2>
          <p className="max-w-md text-sm text-vault-muted">
            Lance une installation depuis ta bibliothèque, Steam ou l’appli Xbox : elle apparaîtra ici en quelques
            secondes, avec sa progression, son débit et le temps restant.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {downloads.map((d) => (
              <DownloadRow key={keyOf(d)} dl={d} game={matchGame(d, games)} onSelect={onSelect} />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {finished.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-black tracking-tight text-vault-muted">
            <span>✅</span> Terminés depuis l’ouverture de la page
          </h2>
          <ul className="flex flex-col gap-2">
            {finished.map((f) => (
              <li
                key={`${f.key}-${f.at}`}
                className="glass flex items-center gap-3 rounded-xl border border-vault-border px-3 py-2"
              >
                {f.coverUrl ? (
                  <img src={f.coverUrl} alt="" className="h-10 w-7 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-vault-panel text-sm">🎮</span>
                )}
                <span className="truncate text-sm font-semibold">{f.name}</span>
                <span className="ml-auto shrink-0 text-xs text-vault-muted tabular-nums">
                  {new Date(f.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
