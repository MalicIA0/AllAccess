import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DashboardStats, Game } from '../../../shared/types'
import { tierFor } from '../lib/tiers'

/**
 * Widget « Quoi jouer ce soir ? » — pioche un jeu installé et pas encore terminé.
 * Purement local (aucun appel réseau) : juste un filtre + un tirage sur la bibliothèque déjà chargée.
 */
function WhatToPlayTonight({ games, onSelect }: { games: Game[]; onSelect: (id: string) => void }): React.JSX.Element | null {
  const candidates = useMemo(
    () =>
      games.filter((g) => {
        if (g.hidden || !g.installed) return false
        // pas déjà 100% terminé (si des succès sont suivis)
        if (g.achievementsTotal > 0 && g.achievementsUnlocked >= g.achievementsTotal) return false
        return true
      }),
    [games]
  )

  const [pick, setPick] = useState<Game | null>(null)

  useEffect(() => {
    if (candidates.length === 0) {
      setPick(null)
      return
    }
    setPick((prev) => (prev && candidates.some((c) => c.id === prev.id) ? prev : candidates[Math.floor(Math.random() * candidates.length)]))
  }, [candidates])

  const reroll = (): void => {
    if (candidates.length === 0) return
    // évite de retomber sur le même jeu si on a le choix
    const others = candidates.filter((c) => c.id !== pick?.id)
    const pool = others.length > 0 ? others : candidates
    setPick(pool[Math.floor(Math.random() * pool.length)])
  }

  if (candidates.length === 0) return null

  return (
    <section className="glass relative mb-8 overflow-hidden rounded-2xl border border-vault-accent/30 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">🎲 Quoi jouer ce soir ?</h2>
        <button
          onClick={reroll}
          className="rounded-xl border border-vault-border px-3 py-1.5 text-xs font-semibold text-vault-muted transition hover:border-vault-accent/50 hover:text-vault-text"
        >
          🎲 Relancer
        </button>
      </div>
      <AnimatePresence mode="wait">
        {pick && (
          <motion.button
            key={pick.id}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            onClick={() => onSelect(pick.id)}
            className="flex w-full items-center gap-4 rounded-xl p-2 text-left transition hover:bg-white/5"
          >
            <div className="h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-vault-panel">
              {pick.coverUrl ? (
                <img src={pick.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-vault-muted">
                  {pick.name.slice(0, 2)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-black">{pick.name}</p>
              <p className="mt-1 text-xs text-vault-muted">
                {pick.achievementsTotal > 0
                  ? `${pick.achievementsUnlocked}/${pick.achievementsTotal} succès`
                  : 'Prêt à lancer'}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-gradient-to-r from-vault-accent to-vault-accent2 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-vault-accent/25">
              Voir la fiche
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </section>
  )
}

function StatCard({ label, value, sub, accent, index, onClick }: {
  label: string
  value: string
  sub?: string
  accent?: string
  index: number
  onClick?: () => void
}): React.JSX.Element {
  const Tag = onClick ? motion.button : motion.div
  return (
    <Tag
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      whileHover={
        onClick ? { y: -6, scale: 1.03, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } } : undefined
      }
      whileTap={onClick ? { scale: 0.98, transition: { type: 'tween', duration: 0.1 } } : undefined}
      onClick={onClick}
      className={`glass rounded-2xl p-5 text-left shadow-lg shadow-black/0 ${
        onClick ? 'cursor-pointer transition-colors duration-150 ease-out hover:border-vault-accent/40 hover:shadow-vault-accent/20' : ''
      }`}
    >
      <p className="text-xs font-semibold tracking-widest text-vault-muted uppercase">{label}</p>
      <p className={`mt-2 text-3xl font-black ${accent ?? 'text-vault-text'}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-vault-muted">{sub}</p>}
    </Tag>
  )
}

export default function Dashboard({
  games,
  onSelect,
  onNavigateLibrary
}: {
  games: Game[]
  onSelect: (id: string) => void
  onNavigateLibrary: (filter: 'all' | 'owned' | 'gamepass') => void
}): React.JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    void window.api.getStats().then(setStats)
    const off = window.api.onLibraryChanged(() => void window.api.getStats().then(setStats))
    return off
  }, [])

  if (!stats) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-2xl" />
        ))}
      </div>
    )
  }

  const achPct =
    stats.totalAchievements > 0 ? Math.round((stats.unlockedAchievements / stats.totalAchievements) * 100) : 0

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black tracking-tight">Dashboard</h1>

      <WhatToPlayTonight games={games} onSelect={onSelect} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          index={0}
          label="Jeux installés"
          value={String(stats.installedGames)}
          sub="prêts à jouer"
          onClick={() => onNavigateLibrary('all')}
        />
        <StatCard
          index={1}
          label="Achetés"
          value={String(stats.ownedGames)}
          accent="text-vault-accent"
          onClick={() => onNavigateLibrary('owned')}
        />
        <StatCard
          index={2}
          label="Game Pass"
          value={String(stats.gamepassGames)}
          accent="text-vault-green"
          onClick={() => onNavigateLibrary('gamepass')}
        />
        <StatCard
          index={3}
          label="Succès"
          value={`${stats.unlockedAchievements}`}
          sub={`sur ${stats.totalAchievements} · ${achPct}%`}
          accent="text-vault-gold"
        />
        <StatCard index={4} label="Jeux 100%" value={String(stats.perfectGames)} accent="text-vault-gold" />
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.36 }}
          className="glass col-span-2 rounded-2xl p-5"
        >
          <p className="text-xs font-semibold tracking-widest text-vault-muted uppercase">Complétion globale</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${achPct}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-vault-accent via-vault-accent2 to-vault-gold"
            />
          </div>
          <p className="mt-2 text-right text-sm font-bold text-vault-gold">{achPct}%</p>
        </motion.div>
      </div>

      {stats.nextChallenges.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">🎯 Prochains défis</h2>
          <p className="mb-3 text-xs text-vault-muted">
            Les succès les plus accessibles dans tes jeux en cours — couleur selon leur rareté mondiale.
          </p>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {stats.nextChallenges.map((a, i) => {
              const tier = tierFor(a.rarity)
              return (
                <motion.button
                  key={`${a.gameId}:${a.key}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => onSelect(a.gameId)}
                  className={`glass flex items-center gap-3 rounded-xl border-l-4 p-3 text-left transition hover:border-vault-accent/40 ${tier.border} ${tier.glow}`}
                >
                  {a.iconGrayUrl || a.iconUrl ? (
                    <img src={(a.iconGrayUrl ?? a.iconUrl)!} alt="" className="h-10 w-10 rounded-lg opacity-85 grayscale" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5">🔒</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{a.name}</p>
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wide ${tier.chip}`}>
                        {tier.label.toUpperCase()}
                      </span>
                    </div>
                    <p className="truncate text-xs text-vault-muted">{a.gameName}</p>
                  </div>
                  {a.rarity != null && (
                    <p className="shrink-0 text-xs font-bold text-vault-muted">{a.rarity.toFixed(1)}%</p>
                  )}
                </motion.button>
              )
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 pb-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-bold">🏆 Derniers succès</h2>
          <div className="flex flex-col gap-2">
            {stats.recentUnlocks.length === 0 && <p className="text-sm text-vault-muted">Aucun succès synchronisé pour l'instant.</p>}
            {stats.recentUnlocks.map((a, i) => (
              <motion.button
                key={`${a.gameId}:${a.key}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => onSelect(a.gameId)}
                className="glass flex items-center gap-3 rounded-xl p-3 text-left transition hover:border-vault-accent/40"
              >
                {a.iconUrl ? (
                  <img src={a.iconUrl} alt="" className="h-10 w-10 rounded-lg" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-vault-gold/15">🏆</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-vault-gold">{a.name}</p>
                  <p className="truncate text-xs text-vault-muted">{a.gameName}</p>
                </div>
                {a.unlockTime && (
                  <p className="shrink-0 text-xs text-vault-muted">
                    {new Date(a.unlockTime).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  </p>
                )}
              </motion.button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-bold">🎮 Dernières sessions</h2>
          <div className="flex flex-col gap-2">
            {stats.recentSessions.length === 0 && (
              <p className="text-sm text-vault-muted">
                Les sessions apparaîtront ici dès que tu lanceras un jeu pendant qu'All Access tourne.
              </p>
            )}
            {stats.recentSessions.map((s, i) => {
              const dur = s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) : null
              return (
                <motion.button
                  key={s.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => onSelect(s.gameId)}
                  className="glass flex items-center gap-3 rounded-xl p-3 text-left transition hover:border-vault-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.gameName}</p>
                    <p className="text-xs text-vault-muted">
                      {new Date(s.startedAt).toLocaleString('fr-FR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs font-bold text-vault-accent2">
                    {dur === null ? 'En cours' : dur < 60 ? `${dur} min` : `${Math.floor(dur / 60)} h ${dur % 60}`}
                  </p>
                </motion.button>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
