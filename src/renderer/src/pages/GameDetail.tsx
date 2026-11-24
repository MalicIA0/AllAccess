import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { Achievement, DownloadInfo, Game, InstallProgressEvent, Ownership } from '../../../shared/types'
import { DeviceBadge, DlcBadge, OwnershipBadge, PlatformBadge } from '../components/GameCard'
import UninstallDialog from '../components/UninstallDialog'
import LinkXboxAchievementsDialog from '../components/LinkXboxAchievementsDialog'
import { TIER_LEGEND, tierFor } from '../lib/tiers'
import { GB, formatEta, formatRate, formatSize, normName, pctOf, useSmoothedBytes } from '../lib/downloads'

const isBonus = (key: string): boolean => key.startsWith('xbox-bonus:')

function formatPlaytime(min: number): string {
  if (min <= 0) return '—'
  const h = Math.floor(min / 60)
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`
}

function formatDate(ts: number | null): string {
  return ts ? new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

/* formatage, extrapolation et rattachement des téléchargements : voir lib/downloads */

/**
 * Barre de téléchargement. Steam fournit une progression exacte (appmanifest) ; pour
 * Xbox/Game Pass la quantité téléchargée est réelle (taille du dossier) mais la taille
 * totale n'est pas exposée → saisie par l'utilisateur. Sans total, on affiche les Go
 * téléchargés + une barre indéterminée animée.
 */
function DownloadBar({ dl }: { dl: DownloadInfo }): React.JSX.Element {
  const [editing, setEditing] = useState(!dl.exact && dl.totalBytes == null)
  const [gbInput, setGbInput] = useState(dl.totalBytes != null ? (dl.totalBytes / GB).toFixed(1) : '')

  // avancée continue entre deux mesures (les sources ne bougent qu'au rythme du sondage)
  const shown = useSmoothedBytes(dl)
  const pct = pctOf(shown, dl.totalBytes)
  const bps = dl.paused ? 0 : (dl.bytesPerSecond ?? 0)
  const remainingSec = bps > 0 && dl.totalBytes ? Math.max(0, (dl.totalBytes - shown) / bps) : null

  const saveTotal = async (): Promise<void> => {
    if (!dl.storeId) return
    const gb = parseFloat(gbInput.replace(',', '.'))
    await window.api.setDownloadTotal(dl.storeId, Number.isFinite(gb) && gb > 0 ? gb * GB : 0)
    setEditing(false)
  }

  return (
    <div className="w-full rounded-xl border border-vault-accent/30 bg-vault-accent/5 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={`flex items-center gap-2 font-bold ${dl.paused ? 'text-amber-400' : 'text-vault-accent2'}`}>
          <span className={dl.paused ? '' : 'inline-block animate-bounce'}>{dl.paused ? '⏸' : '⬇'}</span>
          {dl.paused ? 'Téléchargement en pause' : 'Téléchargement en cours'}
        </span>
        <span className="text-vault-muted tabular-nums">
          {formatSize(shown)}
          {dl.totalBytes ? ` / ${formatSize(dl.totalBytes)}` : ''}
          {pct != null ? ` · ${pct}%` : ''}
        </span>
        {/* Vitesse + temps restant : c'est ce qui rend la progression réellement « vivante » */}
        {bps > 0 && (
          <span className="text-vault-accent2 tabular-nums">
            {formatRate(bps)}
            {remainingSec != null && <span className="text-vault-muted"> · reste {formatEta(remainingSec)}</span>}
          </span>
        )}
        {!dl.exact && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="ml-auto text-xs font-semibold text-vault-muted underline-offset-2 transition hover:text-vault-text hover:underline"
          >
            {dl.totalBytes ? 'Modifier la taille' : 'Définir la taille totale'}
          </button>
        )}
      </div>

      {/* barre : déterminée (%) si total connu, sinon indéterminée animée */}
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
        {pct != null ? (
          // transition linéaire courte : la largeur suit l'avancée continue sans à-coups
          // ni rebond (un easeOut de 0,6 s donnait une barre qui « rattrapait » par sauts)
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-vault-accent to-vault-accent2"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.15, ease: 'linear' }}
          />
        ) : (
          <div className="dl-indeterminate h-full w-1/3 rounded-full bg-gradient-to-r from-vault-accent to-vault-accent2" />
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
  )
}

export default function GameDetail({
  gameId,
  running,
  onClose
}: {
  gameId: string
  running: boolean
  onClose: () => void
}): React.JSX.Element {
  const [game, setGame] = useState<Game | null>(null)
  const [achievements, setAchievements] = useState<Achievement[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [tab, setTab] = useState<'todo' | 'done' | 'all'>('todo')
  const [showUninstall, setShowUninstall] = useState(false)
  const [uninstallBusy, setUninstallBusy] = useState(false)
  const [uninstallError, setUninstallError] = useState<string | null>(null)
  const [uninstallMessage, setUninstallMessage] = useState<string | null>(null)
  const [showLinkXbox, setShowLinkXbox] = useState(false)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkMessage, setLinkMessage] = useState<string | null>(null)
  const [download, setDownload] = useState<DownloadInfo | null>(null)

  useEffect(() => {
    void window.api.getGame(gameId).then(({ game, achievements }) => {
      setGame(game)
      setAchievements(achievements)
    })
  }, [gameId])

  useEffect(() => {
    setInstalling(false)
    return window.api.onInstallProgress((e: InstallProgressEvent) => {
      if (e.gameId !== gameId) return
      if (e.status === 'started') setInstalling(true)
      else {
        setInstalling(false)
        if (e.status === 'done') void window.api.getGame(gameId).then(({ game }) => setGame(game))
      }
    })
  }, [gameId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Téléchargement en cours pour CE jeu ? Sondage toutes les SECONDES tant qu'un
  // téléchargement est actif (4 s sinon) : sur la fiche du jeu, la barre doit vivre.
  // Steam : rattachement fiable par appid. Xbox : par StoreId (fiable) ou par nom.
  useEffect(() => {
    if (!game || (game.platform !== 'xbox' && game.platform !== 'steam')) {
      setDownload(null)
      return
    }
    let alive = true
    const poll = async (): Promise<void> => {
      const list = await window.api.getActiveDownloads().catch((): DownloadInfo[] => [])
      if (!alive) return
      const wanted = normName(game.name)
      const match =
        game.platform === 'steam'
          ? (list.find((d) => d.platform === 'steam' && d.storeId === game.externalId) ?? null)
          : (list.find(
              (d) => d.platform === 'xbox' && d.storeId && game.storeProductId && d.storeId === game.storeProductId
            ) ??
            list.find((d) => d.platform === 'xbox' && normName(d.name) === wanted) ??
            null)
      setDownload(match)
      // cadence adaptative : rapide pendant un téléchargement actif, économe sinon
      const next = match && !match.paused ? 1000 : 4000
      if (alive) timer = setTimeout(() => void poll(), next)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    void poll()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [game])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    setAchievements(await window.api.refreshAchievements(gameId))
    const { game: g } = await window.api.getGame(gameId)
    setGame(g)
    setRefreshing(false)
  }

  const launch = async (): Promise<void> => {
    setLaunchError(null)
    const res = await window.api.launchGame(gameId)
    if (!res.ok) setLaunchError(res.error ?? 'Échec du lancement')
  }

  const setOwnership = async (o: Ownership | null): Promise<void> => {
    await window.api.setOwnership(gameId, o)
    const { game: g } = await window.api.getGame(gameId)
    setGame(g)
  }

  const closeUninstall = (): void => {
    setShowUninstall(false)
    setUninstallError(null)
    setUninstallMessage(null)
  }

  const confirmUninstall = async (deleteSave: boolean): Promise<void> => {
    setUninstallBusy(true)
    setUninstallError(null)
    const r = await window.api.uninstallGame(gameId, deleteSave)
    setUninstallBusy(false)
    if (!r.ok) {
      setUninstallError(r.error ?? 'Échec de la désinstallation')
      return
    }
    setUninstallMessage(r.message ?? 'Désinstallation lancée.')
    const { game: g } = await window.api.getGame(gameId)
    setGame(g)
  }

  const closeLinkXbox = (): void => {
    setShowLinkXbox(false)
    setLinkError(null)
    setLinkMessage(null)
  }

  const confirmLinkXbox = async (urlOrId: string): Promise<void> => {
    setLinkBusy(true)
    setLinkError(null)
    const r = await window.api.linkXboxAchievements(gameId, urlOrId)
    setLinkBusy(false)
    if (!r.ok) {
      setLinkError(r.error ?? 'Échec de la recherche')
      return
    }
    setLinkMessage(`${r.count} succès Xbox ajoutés — « ${r.title} »`)
    const { achievements: a } = await window.api.getGame(gameId)
    setAchievements(a)
  }

  // Pointage manuel, valable pour tout succes : indispensable quand le compte de plateforme est
  // deconnecte (les succes restent connus en base, seul leur etat ne peut plus etre synchronise).
  const toggleManual = async (key: string, unlocked: boolean): Promise<void> => {
    const r = await window.api.toggleManualAchievement(gameId, key, unlocked)
    if (r.achievements) setAchievements(r.achievements)
  }

  // Rattrapage des succès obtenus compte Steam déconnecté : lit le cache local du client Steam,
  // crédite les manquants à leur vraie date, et rejoue les bannières.
  const [recovering, setRecovering] = useState(false)
  const [recoverMsg, setRecoverMsg] = useState<string | null>(null)
  const recoverOffline = async (): Promise<void> => {
    setRecovering(true)
    setRecoverMsg(null)
    try {
      const r = await window.api.recoverOfflineAchievements(gameId)
      if (r.achievements) setAchievements(r.achievements)
      const dates = (r.redated ?? 0) > 0 ? ` — ${r.redated} date${(r.redated ?? 0) > 1 ? 's' : ''} corrigée${(r.redated ?? 0) > 1 ? 's' : ''}` : ''
      if (!r.ok) setRecoverMsg(r.error ?? 'Échec de la récupération.')
      else if ((r.recovered ?? 0) === 0)
        setRecoverMsg(`Rien à rattraper — les ${r.trouves} succès du cache Steam sont déjà crédités${dates}.`)
      else
        setRecoverMsg(
          `${r.recovered} succès rattrapé${(r.recovered ?? 0) > 1 ? 's' : ''} : ${(r.noms ?? []).join(', ')}${dates}`
        )
    } finally {
      setRecovering(false)
    }
  }

  const unlocked = useMemo(() => achievements.filter((a) => a.unlocked), [achievements])
  const todo = useMemo(
    () =>
      achievements
        .filter((a) => !a.unlocked)
        // du plus accessible (rareté haute) au plus légendaire (rareté basse)
        .sort((a, b) => (b.rarity ?? -1) - (a.rarity ?? -1)),
    [achievements]
  )
  const shown = tab === 'todo' ? todo : tab === 'done' ? unlocked : achievements

  if (!game) return <></>
  const pct = achievements.length > 0 ? Math.round((unlocked.length / achievements.length) * 100) : 0

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, scale: 0.96 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 40, scale: 0.96, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-vault-border bg-vault-panel shadow-2xl"
      >
        {/* Hero */}
        <div className="relative h-56 shrink-0 overflow-hidden">
          {game.heroUrl ? (
            <img src={game.heroUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-vault-accent/30 to-vault-accent2/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-vault-panel via-vault-panel/40 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-vault-muted transition hover:bg-black/80 hover:text-white"
          >
            ✕
          </button>
          <div className="absolute bottom-4 left-6 right-6">
            <div className="mb-2 flex items-center gap-2">
              <PlatformBadge platform={game.platform} />
              <DeviceBadge game={game} />
              <OwnershipBadge game={game} />
              <DlcBadge game={game} size="md" />
              {running && (
                <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-bold text-vault-green">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-vault-green" /> EN JEU
                </span>
              )}
            </div>
            <h2 className="text-3xl font-black drop-shadow-lg">{game.name}</h2>
          </div>
        </div>

        {/* Actions + stats */}
        <div className="flex flex-wrap items-center gap-4 border-b border-vault-border/60 px-6 py-4">
          <button
            onClick={() => void launch()}
            disabled={installing}
            className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-8 py-2.5 font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
          >
            {installing
              ? '⏳ Installation…'
              : download
                ? '⬇ Téléchargement…'
                : game.installed
                  ? '▶ Jouer'
                  : '⬇ Installer'}
          </button>
          <div className="text-sm text-vault-muted">
            <span className="font-semibold text-vault-text">{formatPlaytime(game.playtimeMinutes)}</span> de jeu
          </div>
          {game.lastPlayed && (
            <div className="text-sm text-vault-muted">
              Dernière session : <span className="font-semibold text-vault-text">{formatDate(game.lastPlayed)}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <select
              value={game.ownershipOverride ?? ''}
              onChange={(e) => void setOwnership((e.target.value || null) as Ownership | null)}
              className="rounded-lg border border-vault-border bg-vault-card px-2 py-1.5 text-xs text-vault-muted outline-none"
              title="Corriger le statut Acheté / Game Pass"
            >
              <option value="">Statut auto</option>
              <option value="owned">Acheté</option>
              <option value="gamepass">Game Pass</option>
              <option value="both">Acheté + Game Pass</option>
            </select>
            {(game.platform === 'steam' || game.platform === 'xbox') && (
              <button
                onClick={() => void refresh()}
                disabled={refreshing}
                className="rounded-lg border border-vault-border px-3 py-1.5 text-xs font-semibold text-vault-muted transition hover:border-vault-accent/50 hover:text-vault-text disabled:opacity-40"
              >
                {refreshing ? '…' : '⟳ Actualiser'}
              </button>
            )}
            {game.platform === 'steam' && (
              <button
                onClick={() => void recoverOffline()}
                disabled={recovering}
                className="rounded-lg border border-vault-border px-3 py-1.5 text-xs font-semibold text-vault-muted transition hover:border-vault-gold/60 hover:text-vault-gold disabled:opacity-40"
                title="Lit le cache de succès du client Steam sur ce PC (sans réseau ni compte connecté), crédite ceux qui manquent à leur date réelle et rejoue les bannières"
              >
                {recovering ? '…' : '🏆 Revivre les succès manqués'}
              </button>
            )}
            {game.platform !== 'xbox' && (
              <button
                onClick={() => setShowLinkXbox(true)}
                className="rounded-lg border border-vault-border px-3 py-1.5 text-xs font-semibold text-vault-muted transition hover:border-[#107c10]/60 hover:text-[#3fb950]"
                title="Ajouter la liste des succès Xbox de ce jeu, à cocher toi-même — suivi local uniquement"
              >
                🎮 Succès Xbox
              </button>
            )}
            {game.installed && (
              <button
                onClick={() => setShowUninstall(true)}
                className="rounded-lg border border-vault-border px-3 py-1.5 text-xs font-semibold text-vault-muted transition hover:border-red-400/50 hover:text-red-400"
              >
                🗑 Désinstaller
              </button>
            )}
          </div>
          {launchError && <p className="w-full text-sm text-red-400">{launchError}</p>}
          {download && <DownloadBar dl={download} />}
        </div>

        {/* Succès */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <h3 className="text-lg font-bold">Succès</h3>
            {achievements.length > 0 ? (
              <>
                <div className="h-2 max-w-xs flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full ${pct === 100 ? 'bg-vault-gold' : 'bg-gradient-to-r from-vault-accent to-vault-accent2'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-sm font-bold text-vault-muted">
                  {unlocked.length}/{achievements.length} · {pct}%
                </span>
                <div className="ml-auto flex gap-1 rounded-xl border border-vault-border p-1">
                  {(
                    [
                      ['todo', `🎯 À faire (${todo.length})`],
                      ['done', `🏆 Débloqués (${unlocked.length})`],
                      ['all', 'Tous']
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition ${
                        tab === id ? 'bg-vault-accent/25 text-vault-text' : 'text-vault-muted hover:text-vault-text'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-sm text-vault-muted">
                {game.platform === 'steam' || game.platform === 'xbox'
                  ? 'Aucun succès connu — clique sur Actualiser'
                  : 'Pas de succès pour cette plateforme'}
                {game.platform !== 'xbox' && ' — ou ajoute la liste Xbox via « 🎮 Succès Xbox » ci-dessus.'}
              </span>
            )}
          </div>

          {recoverMsg && (
            <p className="mb-3 rounded-lg border border-vault-gold/30 bg-vault-gold/[0.07] px-3 py-2 text-xs text-vault-gold">
              {recoverMsg}
            </p>
          )}

          {/* Légende des tiers de défi */}
          {achievements.length > 0 && tab !== 'done' && (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-vault-muted">
              {TIER_LEGEND.map((t) => (
                <span key={t.label} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${t.dot}`} />
                  {t.label} <span className="opacity-60">{t.range}</span>
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 pb-4">
            {shown.map((a) => {
              const tier = tierFor(a.rarity)
              const bonus = isBonus(a.key)
              return (
                <div
                  key={a.key}
                  onClick={() => void toggleManual(a.key, !a.unlocked)}
                  className={`group flex cursor-pointer items-center gap-4 rounded-xl border border-l-4 p-3 transition hover:brightness-110 ${
                    a.unlocked
                      ? `reward-shine border-vault-gold/25 border-l-vault-gold/70 bg-vault-gold/[0.06] ${
                          tier.rank >= 4 ? 'shadow-[inset_0_0_28px_rgba(251,191,36,0.1)]' : ''
                        }`
                      : `border-vault-border/60 ${tier.border} bg-vault-card/50 ${tier.glow}`
                  }`}
                  title={a.unlocked ? 'Cliquer pour reverrouiller' : 'Cliquer pour marquer comme obtenu'}
                >
                  {(a.unlocked ? a.iconUrl : a.iconGrayUrl) ? (
                    <img
                      src={(a.unlocked ? a.iconUrl : a.iconGrayUrl)!}
                      alt=""
                      loading="lazy"
                      className={`h-12 w-12 rounded-lg ${
                        a.unlocked
                          ? 'ring-1 ring-vault-gold/50 shadow-[0_0_14px_rgba(251,191,36,0.25)]'
                          : 'opacity-80 grayscale'
                      }`}
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5 text-xl">
                      {a.unlocked ? '🏆' : '🔒'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`truncate font-semibold ${a.unlocked ? 'text-vault-gold' : ''}`}>{a.name}</p>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wide ${tier.chip}`}>
                        {tier.label.toUpperCase()}
                      </span>
                      {bonus && (
                        <span className="shrink-0 rounded-md bg-[#107c10]/20 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-[#3fb950]">
                          XBOX · MANUEL
                        </span>
                      )}
                    </div>
                    {a.description && <p className="truncate text-sm text-vault-muted">{a.description}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {bonus ? (
                      <span
                        className={`text-xs font-bold ${a.unlocked ? 'text-vault-gold' : 'text-vault-muted'}`}
                      >
                        {a.unlocked ? '☑ Obtenu' : '☐ Marquer obtenu'}
                      </span>
                    ) : (
                      <>
                        {a.unlocked && a.unlockTime && (
                          <p className="text-xs text-vault-muted">{formatDate(a.unlockTime)}</p>
                        )}
                        {a.rarity != null && (
                          <p className={`text-xs font-bold ${a.rarity < 10 ? 'text-vault-gold' : 'text-vault-muted'}`}>
                            {a.rarity < 5 ? '💎 ' : ''}
                            {a.rarity.toFixed(1)}% des joueurs
                          </p>
                        )}
                        {/* discret : ne se montre qu'au survol, pour ne pas alourdir une longue liste */}
                        <p className="text-[10px] font-bold text-vault-muted opacity-0 transition group-hover:opacity-100">
                          {a.unlocked ? '☑ Reverrouiller' : '☐ Marquer obtenu'}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            {tab === 'todo' && achievements.length > 0 && todo.length === 0 && (
              <p className="py-6 text-center text-sm font-semibold text-vault-gold">
                💯 Jeu complété à 100 % — aucun défi restant !
              </p>
            )}
          </div>
        </div>
      </motion.div>

      {showUninstall && (
        <UninstallDialog
          gameName={game.name}
          busy={uninstallBusy}
          error={uninstallError}
          message={uninstallMessage}
          onConfirm={(deleteSave) => void confirmUninstall(deleteSave)}
          onCancel={closeUninstall}
        />
      )}

      {showLinkXbox && (
        <LinkXboxAchievementsDialog
          gameName={game.name}
          busy={linkBusy}
          error={linkError}
          message={linkMessage}
          onConfirm={(urlOrId) => void confirmLinkXbox(urlOrId)}
          onCancel={closeLinkXbox}
        />
      )}
    </motion.div>
  )
}
