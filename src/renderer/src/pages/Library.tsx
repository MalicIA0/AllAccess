import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { DiskInfo, DownloadInfo, Game, Ownership, PreloadInfo } from '../../../shared/types'
import GameCard from '../components/GameCard'
import UninstallDialog from '../components/UninstallDialog'

type PlatformFilter = 'all' | 'steam' | 'xbox' | 'rockstar' | 'epic' | 'ubisoft'
export type OwnershipFilter = 'all' | 'owned' | 'gamepass'

function effectiveOwnership(g: Game): Ownership {
  return g.ownershipOverride ?? g.ownership
}

/** Même normalisation que GameDetail : rattache un téléchargement Xbox à sa fiche par nom. */
function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Associe chaque téléchargement en cours à l'id du jeu correspondant de la bibliothèque.
 * Valeur = % (0-100) si le total est connu, null sinon (badge sans pourcentage).
 */
/** Progression d'un jeu en téléchargement + son état d'avancement côté plateforme. */
export interface DownloadState {
  pct: number | null
  paused: boolean
  /** Cause d'un blocage total (disque plein, erreur d'écriture…), null si tout va bien */
  blockedReason: string | null
}

function mapDownloadsToGames(list: DownloadInfo[], games: Game[]): Map<string, DownloadState> {
  const out = new Map<string, DownloadState>()
  for (const d of list) {
    const game =
      d.platform === 'steam'
        ? games.find((g) => g.platform === 'steam' && g.externalId === d.storeId)
        : (games.find((g) => g.platform === 'xbox' && d.storeId && g.storeProductId === d.storeId) ??
          games.find((g) => g.platform === 'xbox' && normName(g.name) === normName(d.name)))
    if (!game) continue
    const pct =
      d.totalBytes && d.totalBytes > 0
        ? Math.min(100, Math.round((d.downloadedBytes / d.totalBytes) * 100))
        : null
    out.set(game.id, { pct, paused: d.paused === true, blockedReason: d.blockedReason ?? null })
  }
  return out
}

/** Formate un nombre de Go : « 380 Go », ou « 1,2 To » au-delà de 1024. */
function fmtSize(gb: number): string {
  return gb >= 1024 ? `${(gb / 1024).toFixed(1).replace('.', ',')} To` : `${Math.round(gb)} Go`
}

/** Bandeau espace disque (par lecteur fixe) — pris / libres, avec jauge. */
function DiskBar({ disks }: { disks: DiskInfo[] }): React.JSX.Element | null {
  if (disks.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {disks.map((d) => {
        const pct = d.totalGb > 0 ? Math.min(100, (d.usedGb / d.totalGb) * 100) : 0
        const low = d.freeGb < 25 // espace critique
        return (
          <div
            key={d.drive}
            title={`${d.drive} — ${fmtSize(d.usedGb)} utilisés sur ${fmtSize(d.totalGb)}`}
            className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs"
          >
            <span className="font-bold text-vault-muted">💾 {d.drive}</span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${low ? 'bg-red-500' : 'bg-gradient-to-r from-vault-accent to-vault-accent2'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-vault-muted">
              <b className="text-vault-text">{fmtSize(d.usedGb)}</b> pris ·{' '}
              <b className={low ? 'text-red-400' : 'text-vault-accent2'}>{fmtSize(d.freeGb)}</b> libres
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ContextMenu({
  x,
  y,
  hidden,
  installed,
  onToggleHidden,
  onSetDlc,
  onUninstall,
  onDelete,
  onClose
}: {
  x: number
  y: number
  hidden: boolean
  installed: boolean
  onToggleHidden: () => void
  onSetDlc: () => void
  onUninstall: () => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onDown = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: x, top: y }}
      className="glass fixed z-50 min-w-[160px] rounded-xl border border-vault-border p-1 shadow-2xl"
    >
      <button
        onClick={() => {
          onToggleHidden()
          onClose()
        }}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-vault-text transition hover:bg-white/10"
      >
        {hidden ? '👁 Afficher' : '🙈 Masquer'}
      </button>
      <button
        onClick={() => {
          onSetDlc()
          onClose()
        }}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-vault-text transition hover:bg-white/10"
      >
        🧩 Définir les DLC possédés…
      </button>
      {installed && (
        <button
          onClick={() => {
            onUninstall()
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-400 transition hover:bg-red-400/10"
        >
          🗑 Désinstaller…
        </button>
      )}
      {hidden && (
        <button
          onClick={() => {
            onDelete()
            onClose()
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-red-400 transition hover:bg-red-400/10"
        >
          ❌ Supprimer la fiche…
        </button>
      )}
    </motion.div>
  )
}

/** Confirmation avant suppression définitive d'une fiche jeu masquée. */
function DeleteGameDialog({
  game,
  onConfirm,
  onClose
}: {
  game: Game
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass w-full max-w-sm rounded-2xl border border-vault-border p-6"
      >
        <h3 className="mb-1 text-lg font-black tracking-tight">❌ Supprimer la fiche</h3>
        <p className="mb-4 truncate text-sm text-vault-muted">{game.name}</p>
        <p className="mb-5 text-xs leading-relaxed text-vault-muted">
          Retire définitivement ce jeu de ta bibliothèque locale (succès suivis, temps de jeu, tout). Si tu le
          possèdes toujours sur {game.platform === 'steam' ? 'Steam' : game.platform === 'xbox' ? 'Xbox' : 'sa plateforme'},
          il pourra réapparaître à la prochaine synchronisation.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-vault-border px-4 py-2 text-sm font-semibold text-vault-muted transition hover:text-vault-text"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-red-500 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-red-500/25 transition hover:brightness-110"
          >
            Supprimer
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/** Saisie manuelle du nombre de DLC possédés / total (ex. Destiny, non détectable via Steam). */
function DlcDialog({
  game,
  onSave,
  onClose
}: {
  game: Game
  onSave: (owned: number, total: number) => void
  onClose: () => void
}): React.JSX.Element {
  const [owned, setOwned] = useState(String(game.dlcOwned))
  const [total, setTotal] = useState(String(game.dlcTotal))

  const submit = (): void => {
    const t = Math.max(0, Math.floor(Number(total) || 0))
    const o = Math.max(0, Math.min(Math.floor(Number(owned) || 0), t))
    onSave(o, t)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onMouseDown={(e) => e.stopPropagation()}
        className="glass w-full max-w-sm rounded-2xl border border-vault-border p-6"
      >
        <h3 className="mb-1 text-lg font-black tracking-tight">🧩 DLC possédés</h3>
        <p className="mb-4 truncate text-sm text-vault-muted">{game.name}</p>
        <p className="mb-4 text-xs leading-relaxed text-vault-muted">
          Pour les jeux dont les extensions ne sont pas détectées automatiquement (ex. Destiny&nbsp;2). Ces valeurs ne
          seront plus écrasées par la synchronisation. Mets le total à&nbsp;0 pour revenir en détection automatique.
        </p>
        <div className="mb-5 flex items-center gap-4">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-vault-muted">Possédés</span>
            <input
              type="number"
              min={0}
              value={owned}
              onChange={(e) => setOwned(e.target.value)}
              className="glass w-full rounded-xl px-3 py-2 text-sm outline-none focus:border-vault-accent/50"
            />
          </label>
          <span className="mt-5 text-vault-muted">/</span>
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-vault-muted">Total</span>
            <input
              type="number"
              min={0}
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="glass w-full rounded-xl px-3 py-2 text-sm outline-none focus:border-vault-accent/50"
            />
          </label>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-vault-border px-4 py-2 text-sm font-semibold text-vault-muted transition hover:text-vault-text"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110"
          >
            Enregistrer
          </button>
        </div>
      </motion.div>
    </div>
  )
}

/** Formate une date ISO en « 28 juil. 2026 » (ou null → ''). */
function fmtReleaseDate(iso: string | null): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Nombre de jours restants avant la sortie (arrondi au supérieur, min 0). */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.ceil((t - Date.now()) / 86_400_000))
}

/** Section « À venir · préchargé » : jeux Xbox dont les fichiers sont sur disque mais pas sortis. */
function PreloadSection({ preloads }: { preloads: PreloadInfo[] }): React.JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)
  if (preloads.length === 0) return null
  return (
    <section className="mb-8">
      <button onClick={() => setCollapsed(!collapsed)} className="mb-4 flex w-full items-center gap-3 text-left">
        <span className="text-xl">🕓</span>
        <h2 className="text-lg font-black tracking-tight text-vault-accent2">À venir · préchargé</h2>
        <span className="rounded-full border border-vault-border px-2.5 py-0.5 text-xs font-bold text-vault-muted">
          {preloads.length}
        </span>
        <span className="ml-auto h-px flex-1 bg-vault-border/50" />
        <span className={`text-xs text-vault-muted transition-transform ${collapsed ? '' : 'rotate-180'}`}>▲</span>
      </button>
      {!collapsed && (
        <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5">
          {preloads.map((p) => {
            const days = daysUntil(p.releaseDate)
            return (
              <div
                key={p.storeId}
                title={`${p.name} — préchargé, disponible le ${fmtReleaseDate(p.releaseDate)}`}
                className="glass group relative overflow-hidden rounded-xl border border-vault-border"
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-vault-panel">
                  {p.coverUrl ? (
                    <img
                      src={p.coverUrl}
                      alt={p.name}
                      loading="lazy"
                      className="h-full w-full object-cover opacity-80 saturate-[.85] transition group-hover:opacity-100"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl text-vault-muted">🎮</div>
                  )}
                  {/* voile + badge préchargé */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <span className="absolute left-2 top-2 rounded-full bg-vault-accent2/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white shadow">
                    ⤓ Préchargé
                  </span>
                  {days !== null && (
                    <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">
                      {days === 0 ? "Aujourd'hui" : `J-${days}`}
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-bold text-vault-text">{p.name}</p>
                  <p className="mt-0.5 text-xs text-vault-muted">Dispo le {fmtReleaseDate(p.releaseDate)}</p>
                </div>
              </div>
            )
          })}
        </motion.div>
      )}
    </section>
  )
}

function Section({
  title,
  icon,
  games,
  runningIds,
  onSelect,
  onContextMenu,
  accent,
  defaultCollapsed,
  downloadPcts
}: {
  title: string
  icon: string
  games: Game[]
  runningIds: Set<string>
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, gameId: string) => void
  accent: string
  defaultCollapsed?: boolean
  downloadPcts?: Map<string, DownloadState>
}): React.JSX.Element | null {
  // (callbacks stables : voir Library — permet à GameCard de rester mémoïsée)
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false)
  if (games.length === 0) return null
  return (
    <section className="mb-8">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="mb-4 flex w-full items-center gap-3 text-left"
      >
        <span className="text-xl">{icon}</span>
        <h2 className={`text-lg font-black tracking-tight ${accent}`}>{title}</h2>
        <span className="rounded-full border border-vault-border px-2.5 py-0.5 text-xs font-bold text-vault-muted">
          {games.length}
        </span>
        <span className="ml-auto h-px flex-1 bg-vault-border/50" />
        <span className={`text-xs text-vault-muted transition-transform ${collapsed ? '' : 'rotate-180'}`}>▲</span>
      </button>
      {!collapsed && (
        <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5">
          {games.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              running={runningIds.has(g.id)}
              onSelect={onSelect}
              onOpenMenu={onContextMenu}
              downloadPct={downloadPcts?.has(g.id) ? (downloadPcts.get(g.id)?.pct ?? null) : undefined}
              downloadPaused={downloadPcts?.get(g.id)?.paused}
              downloadBlocked={downloadPcts?.get(g.id)?.blockedReason ?? undefined}
            />
          ))}
        </motion.div>
      )}
    </section>
  )
}

export default function Library({
  games,
  runningIds,
  onSelect,
  onSync,
  ownership,
  onOwnershipChange
}: {
  games: Game[]
  runningIds: Set<string>
  onSelect: (id: string) => void
  onSync: () => void
  ownership: OwnershipFilter
  onOwnershipChange: (o: OwnershipFilter) => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [disks, setDisks] = useState<DiskInfo[]>([])
  // La frappe met à jour l'input tout de suite ; le filtrage (coûteux) suit en tâche de fond
  // sans bloquer la saisie. Zéro dépendance — primitive native React.
  const deferredSearch = useDeferredValue(search)

  // Espace disque : chargé à l'ouverture, puis rafraîchi toutes les 60 s (installe/désinstalle).
  useEffect(() => {
    const load = (): void => void window.api.getDiskUsage().then(setDisks)
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  // Téléchargements en cours (Steam + Xbox) : badge « ⬇ % » sur les cartes, poll toutes les 5 s.
  const [downloadPcts, setDownloadPcts] = useState<Map<string, DownloadState>>(() => new Map())
  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      const list = await window.api.getActiveDownloads().catch((): DownloadInfo[] => [])
      if (!alive) return
      setDownloadPcts((prev) => {
        const next = mapDownloadsToGames(list, games)
        // même contenu → on garde la référence pour ne pas re-rendre toute la grille
        // (comparaison CHAMP À CHAMP : les valeurs sont maintenant des objets, dont la
        // référence change à chaque poll même quand rien n'a bougé)
        if (
          next.size === prev.size &&
          [...next].every(([k, v]) => {
            const p = prev.get(k)
            return p !== undefined && p.pct === v.pct && p.paused === v.paused && p.blockedReason === v.blockedReason
          })
        )
          return prev
        return next
      })
      // cadence adaptative : 1 s tant qu'un téléchargement progresse (le pourcentage doit
      // avancer sous les yeux), 5 s le reste du temps pour ne rien consommer inutilement.
      const active = list.some((d) => !d.paused && !d.blockedReason)
      if (alive) timer = setTimeout(() => void poll(), active ? 1000 : 5000)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    void poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [games])

  // Jeux Xbox préchargés (« à venir ») : sur disque mais pas encore sortis. Récupérés à
  // l'ouverture et à chaque changement de bibliothèque (le scan interroge le Store, mis en cache
  // côté main — bon marché). Rafraîchis aussi par le bouton « Actualiser ».
  const [preloads, setPreloads] = useState<PreloadInfo[]>([])
  const loadPreloads = useCallback((): void => {
    void window.api
      .getXboxPreloads()
      .then((p) => setPreloads(p))
      .catch(() => setPreloads([]))
  }, [])
  useEffect(() => {
    loadPreloads()
  }, [loadPreloads, games])

  const [platform, setPlatform] = useState<PlatformFilter>('all')
  const [menu, setMenu] = useState<{ x: number; y: number; gameId: string } | null>(null)
  const [dlcTarget, setDlcTarget] = useState<Game | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<Game | null>(null)
  const [uninstallBusy, setUninstallBusy] = useState(false)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  const [uninstallMessage, setUninstallMessage] = useState<string | null>(null)

  const openMenu = useCallback((e: React.MouseEvent, gameId: string): void => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, gameId })
  }, [])

  // Bouton « Actualiser » discret : relance le scan LOCAL des jeux installés (hors réseau,
  // quasi instantané). Le main recharge la bibliothèque via « library:changed » s'il y a du neuf.
  const [refreshing, setRefreshing] = useState(false)
  const refreshInstalled = useCallback((): void => {
    setRefreshing(true)
    loadPreloads()
    void window.api.refreshInstalled().finally(() => {
      // court délai pour que l'animation reste visible même quand le scan est instantané
      setTimeout(() => setRefreshing(false), 600)
    })
  }, [loadPreloads])

  const toggleHidden = (id: string, hidden: boolean): void => {
    void window.api.setHidden(id, hidden)
  }

  const saveDlc = (id: string, owned: number, total: number): void => {
    void window.api.setDlcManual(id, owned, total)
  }

  const deleteGame = (id: string): void => {
    void window.api.deleteGame(id)
  }

  const closeUninstall = (): void => {
    setUninstallTarget(null)
    setUninstallError(null)
    setUninstallMessage(null)
  }

  const confirmUninstall = async (deleteSave: boolean): Promise<void> => {
    if (!uninstallTarget) return
    setUninstallBusy(true)
    setUninstallError(null)
    const r = await window.api.uninstallGame(uninstallTarget.id, deleteSave)
    setUninstallBusy(false)
    if (!r.ok) {
      setUninstallError(r.error ?? 'Échec de la désinstallation')
      return
    }
    setUninstallMessage(r.message ?? 'Désinstallation lancée.')
  }

  const sorted = (arr: Game[]): Game[] => [...arr].sort((a, b) => a.name.localeCompare(b.name))

  const matchesSearchAndPlatform = (g: Game, q: string): boolean => {
    if (q && !g.name.toLowerCase().includes(q)) return false
    if (platform !== 'all' && g.platform !== platform) return false
    return true
  }

  const filtered = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim()
    return games.filter((g) => {
      if (g.hidden) return false
      if (!matchesSearchAndPlatform(g, q)) return false
      const own = effectiveOwnership(g)
      if (ownership === 'owned' && own === 'gamepass') return false
      if (ownership === 'gamepass' && own === 'owned') return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, deferredSearch, platform, ownership])

  const hiddenGames = useMemo(() => {
    const q = deferredSearch.toLowerCase().trim()
    return sorted(games.filter((g) => g.hidden && matchesSearchAndPlatform(g, q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, deferredSearch, platform])

  // Jeux préchargés (« à venir ») rattachés à une fiche de la bibliothèque : ils vont dans leur
  // propre section et ne doivent pas apparaître dans « installés » / « à installer ».
  const preloadGameIds = useMemo(
    () => new Set(preloads.map((p) => p.gameId).filter((id): id is string => id !== null)),
    [preloads]
  )
  // Pré-loads visibles selon la recherche/plateforme courante (filtre 'xbox' inclus).
  const visiblePreloads = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    return preloads
      .filter((p) => (platform === 'all' || platform === 'xbox') && (!q || p.name.toLowerCase().includes(q)))
      .slice()
      .sort((a, b) => Date.parse(a.releaseDate ?? '') - Date.parse(b.releaseDate ?? ''))
  }, [preloads, deferredSearch, platform])

  // Les jeux en cours de téléchargement ont leur propre section tout en haut — ils ne doivent
  // pas rester noyés dans « à installer » (ni apparaître en double dans les autres sections).
  const downloadingGames = useMemo(
    () => sorted(filtered.filter((g) => downloadPcts.has(g.id) && !preloadGameIds.has(g.id))),
    [filtered, downloadPcts, preloadGameIds]
  )
  const installedGames = useMemo(
    () => sorted(filtered.filter((g) => g.installed && !downloadPcts.has(g.id) && !preloadGameIds.has(g.id))),
    [filtered, downloadPcts, preloadGameIds]
  )
  const ownedToInstall = useMemo(
    () =>
      sorted(
        filtered.filter(
          (g) =>
            !g.installed &&
            !downloadPcts.has(g.id) &&
            !preloadGameIds.has(g.id) &&
            effectiveOwnership(g) !== 'gamepass'
        )
      ),
    [filtered, downloadPcts, preloadGameIds]
  )
  if (games.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-6xl">🕹️</p>
        <h2 className="text-2xl font-bold">Ta bibliothèque est vide</h2>
        <p className="max-w-md text-vault-muted">
          Va dans les Réglages et connecte tes comptes Steam et Xbox — tes jeux, ton Game Pass et tes succès seront
          importés automatiquement.
        </p>
        <button
          onClick={onSync}
          className="mt-2 rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-6 py-3 font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110"
        >
          ⟳ Synchroniser maintenant
        </button>
      </div>
    )
  }

  const chip = (active: boolean): string =>
    `rounded-full px-4 py-1.5 text-xs font-semibold transition ${
      active
        ? 'bg-vault-accent/20 text-vault-text border border-vault-accent/50'
        : 'border border-vault-border text-vault-muted hover:border-vault-accent/40 hover:text-vault-text'
    }`

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-black tracking-tight">
          Bibliothèque{' '}
          <span className="ml-2 align-middle text-sm font-semibold text-vault-muted">{filtered.length} jeux</span>
        </h1>
        <div className="mr-auto">
          <DiskBar disks={disks} />
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un jeu…"
          className="glass w-64 rounded-xl px-4 py-2 text-sm outline-none placeholder:text-vault-muted focus:border-vault-accent/50"
        />
        <button
          onClick={refreshInstalled}
          disabled={refreshing}
          title="Actualiser les jeux installés — scan local instantané, sans attendre la synchro"
          className="glass flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-vault-muted transition hover:text-vault-text disabled:opacity-60"
        >
          <span className={`inline-block ${refreshing ? 'animate-spin' : ''}`}>⟳</span>
          <span className="hidden sm:inline">Actualiser</span>
        </button>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button className={chip(platform === 'all')} onClick={() => setPlatform('all')}>Toutes plateformes</button>
        <button className={chip(platform === 'steam')} onClick={() => setPlatform('steam')}>Steam</button>
        <button className={chip(platform === 'xbox')} onClick={() => setPlatform('xbox')}>Xbox</button>
        <span className="mx-2 h-5 w-px bg-vault-border" />
        <button className={chip(ownership === 'all')} onClick={() => onOwnershipChange('all')}>Tout</button>
        <button className={chip(ownership === 'owned')} onClick={() => onOwnershipChange('owned')}>💎 Achetés</button>
        <button className={chip(ownership === 'gamepass')} onClick={() => onOwnershipChange('gamepass')}>🟢 Game Pass</button>
      </div>

      <div className="pb-8">
        <PreloadSection preloads={visiblePreloads} />
        <Section
          title="En téléchargement"
          icon="⬇"
          accent="text-vault-accent"
          games={downloadingGames}
          runningIds={runningIds}
          onSelect={onSelect}
          onContextMenu={openMenu}
          downloadPcts={downloadPcts}
        />
        <Section
          title="Installés — prêts à jouer"
          icon="⚡"
          accent="text-vault-accent2"
          games={installedGames}
          runningIds={runningIds}
          onSelect={onSelect}
          onContextMenu={openMenu}
          downloadPcts={downloadPcts}
        />
        <Section
          title="Achetés — à installer"
          icon="💎"
          accent="text-vault-accent"
          games={ownedToInstall}
          runningIds={runningIds}
          onSelect={onSelect}
          onContextMenu={openMenu}
          downloadPcts={downloadPcts}
        />
        <Section
          title="Jeux masqués"
          icon="🙈"
          accent="text-vault-muted"
          games={hiddenGames}
          runningIds={runningIds}
          onSelect={onSelect}
          onContextMenu={openMenu}
          defaultCollapsed
        />
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          hidden={games.find((g) => g.id === menu.gameId)?.hidden ?? false}
          installed={games.find((g) => g.id === menu.gameId)?.installed ?? false}
          onToggleHidden={() => toggleHidden(menu.gameId, !(games.find((g) => g.id === menu.gameId)?.hidden ?? false))}
          onSetDlc={() => {
            const g = games.find((x) => x.id === menu.gameId)
            if (g) setDlcTarget(g)
          }}
          onUninstall={() => {
            const g = games.find((x) => x.id === menu.gameId)
            if (g) setUninstallTarget(g)
          }}
          onDelete={() => {
            const g = games.find((x) => x.id === menu.gameId)
            if (g) setDeleteTarget(g)
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {dlcTarget && (
        <DlcDialog
          game={dlcTarget}
          onSave={(owned, total) => saveDlc(dlcTarget.id, owned, total)}
          onClose={() => setDlcTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteGameDialog
          game={deleteTarget}
          onConfirm={() => {
            deleteGame(deleteTarget.id)
            setDeleteTarget(null)
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {uninstallTarget && (
        <UninstallDialog
          gameName={uninstallTarget.name}
          busy={uninstallBusy}
          error={uninstallError}
          message={uninstallMessage}
          onConfirm={confirmUninstall}
          onCancel={closeUninstall}
        />
      )}
    </div>
  )
}
