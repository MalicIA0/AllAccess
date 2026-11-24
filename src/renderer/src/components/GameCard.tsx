import { memo, useState } from 'react'
import { motion } from 'framer-motion'
import type { Game } from '../../../shared/types'

export function OwnershipBadge({ game }: { game: Game }): React.JSX.Element {
  const own = game.ownershipOverride ?? game.ownership
  if (own === 'gamepass')
    return (
      <span className="rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
        GAME PASS
      </span>
    )
  if (own === 'both')
    return (
      <span className="rounded-md bg-vault-gold/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
        ACHETÉ + GP
      </span>
    )
  return (
    <span className="rounded-md bg-vault-accent/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow">
      ACHETÉ
    </span>
  )
}

/** Le jeu est-il jouable sur ce PC ? (Steam/Rockstar/Epic/Ubisoft = toujours ; Xbox = selon les appareils du titre) */
export function isPcGame(g: Game): boolean {
  if (g.platform !== 'xbox') return true
  return g.devices.some((d) => d === 'PC' || d === 'Win32' || d === 'WindowsOneCore')
}

export function DeviceBadge({ game }: { game: Game }): React.JSX.Element | null {
  if (game.platform !== 'xbox') return null
  if (game.devices.length === 0) return null // ancien enregistrement — re-sync nécessaire
  return isPcGame(game) ? (
    <span className="rounded-md bg-cyan-500/85 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
      💻 PC
    </span>
  ) : (
    <span className="rounded-md bg-zinc-600/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow">
      🎮 CONSOLE
    </span>
  )
}

const PLATFORM_META: Record<Game['platform'], { label: string; style: string }> = {
  steam: { label: 'STEAM', style: 'bg-[#1b2838] text-[#66c0f4]' },
  xbox: { label: 'XBOX', style: 'bg-[#107c10] text-white' },
  rockstar: { label: 'ROCKSTAR', style: 'bg-[#fcaf17] text-black' },
  epic: { label: 'EPIC', style: 'bg-black text-white' },
  ubisoft: { label: 'UBISOFT', style: 'bg-[#0a72f0] text-white' }
}

export function PlatformBadge({ platform }: { platform: Game['platform'] }): React.JSX.Element {
  const meta = PLATFORM_META[platform] ?? PLATFORM_META.steam
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black tracking-wide shadow ${meta.style}`}>
      {meta.label}
    </span>
  )
}

/** Badge « DLC possédés » : doré si tout est possédé, sinon compteur ou « +N » quand le total est inconnu. */
export function DlcBadge({ game, size = 'sm' }: { game: Game; size?: 'sm' | 'md' }): React.JSX.Element | null {
  if (game.dlcTotal <= 0 && game.dlcOwned <= 0) return null
  const complete = game.dlcTotal > 0 && game.dlcOwned >= game.dlcTotal
  const label =
    game.dlcTotal > 0 ? `🧩 ${game.dlcOwned}/${game.dlcTotal} DLC` : `🧩 +${game.dlcOwned} DLC`
  const pad = size === 'md' ? 'px-2 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[10px]'
  const color = complete
    ? 'bg-vault-gold/90 text-black'
    : game.dlcOwned > 0
      ? 'bg-fuchsia-500/85 text-white'
      : 'bg-black/70 text-vault-muted'
  return (
    <span className={`rounded-md font-black tracking-wide shadow ${pad} ${color}`} title="DLC / extensions possédés">
      {complete ? '🧩 DLC ✓' : label}
    </span>
  )
}

/**
 * Carte de jeu — mémoïsée : ne se re-rend que si SON jeu / son état "en jeu" change,
 * pas quand un autre jeu de la grille démarre. `onSelect`/`onOpenMenu` prennent l'id
 * pour rester des références stables côté parent (sinon la mémo serait inutile).
 */
function GameCardBase({
  game,
  running,
  onSelect,
  onOpenMenu,
  downloadPct,
  downloadPaused,
  downloadBlocked
}: {
  game: Game
  running: boolean
  onSelect: (id: string) => void
  onOpenMenu?: (e: React.MouseEvent, id: string) => void
  /** undefined = pas de téléchargement ; null = en cours sans % connu ; nombre = % exact */
  downloadPct?: number | null
  /** Téléchargement à l'arrêt côté plateforme (pause / file d'attente Steam) */
  downloadPaused?: boolean
  /** Cause d'un blocage total (« Espace disque insuffisant… ») */
  downloadBlocked?: string
}): React.JSX.Element {
  // chaîne d'images de secours : jaquette → (Steam : bannière header) → bannière hero
  const sources = [
    game.coverUrl,
    game.platform === 'steam'
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.externalId}/header.jpg`
      : null,
    game.heroUrl
  ].filter((s, i, arr): s is string => !!s && arr.indexOf(s) === i)
  const [imgIdx, setImgIdx] = useState(0)
  const imgSrc = sources[imgIdx]
  const pct =
    game.achievementsTotal > 0 ? Math.round((game.achievementsUnlocked / game.achievementsTotal) * 100) : null

  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ y: -6, scale: 1.03, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { type: 'tween', duration: 0.1 } }}
      onClick={() => onSelect(game.id)}
      onContextMenu={onOpenMenu ? (e) => onOpenMenu(e, game.id) : undefined}
      // content-visibility:auto → le navigateur saute le calcul/paint des cartes hors écran
      // (virtualisation native). contain-intrinsic-size réserve la place pour garder le scroll stable.
      style={{ contentVisibility: 'auto', containIntrinsicSize: '160px 240px' }}
      className={`group relative aspect-[2/3] overflow-hidden rounded-2xl bg-vault-card text-left shadow-lg shadow-black/40 ring-1 transition-colors duration-150 ease-out ${
        running ? 'ring-2 ring-vault-green shadow-vault-green/30' : 'ring-vault-border/60 hover:ring-vault-accent/60'
      }`}
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={game.name}
          loading="lazy"
          onError={() => setImgIdx(imgIdx + 1)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-vault-card to-vault-panel p-3 text-center">
          <span className="text-sm font-bold text-vault-muted">{game.name}</span>
        </div>
      )}

      {/* dégradé bas + infos */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-bold">{game.name}</p>
        {pct !== null && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
              <div
                className={`h-full rounded-full ${pct === 100 ? 'bg-vault-gold' : 'bg-gradient-to-r from-vault-accent to-vault-accent2'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`text-[10px] font-bold ${pct === 100 ? 'text-vault-gold' : 'text-vault-muted'}`}>
              {pct === 100 ? '💯' : `${pct}%`}
            </span>
          </div>
        )}
      </div>

      {/* badges haut */}
      <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-1">
        <div className="flex flex-col items-start gap-1">
          <PlatformBadge platform={game.platform} />
        </div>
        <div className="flex flex-col items-end gap-1">
          <OwnershipBadge game={game} />
          <DlcBadge game={game} />
        </div>
      </div>

      {running && (
        <div className="absolute top-9 left-2 flex items-center gap-1.5 rounded-md bg-black/70 px-1.5 py-0.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-vault-green" />
          <span className="text-[10px] font-bold text-vault-green">EN JEU</span>
        </div>
      )}
      {downloadPct !== undefined && !running && (
        <div
          className="absolute top-9 left-2 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5"
          title={
            downloadBlocked
              ? `Téléchargement bloqué : ${downloadBlocked}`
              : downloadPaused
                ? 'Téléchargement en pause ou en file d’attente — relance-le depuis Steam'
                : 'Téléchargement en cours'
          }
        >
          {/* Bloqué / en pause : pas d'animation et libellé explicite — un « 0 % » figé qui
              rebondit laissait croire à un téléchargement actif qui n'avance pas. */}
          <span className={`text-[10px] ${downloadBlocked || downloadPaused ? '' : 'inline-block animate-bounce'}`}>
            {downloadBlocked ? '⚠' : downloadPaused ? '⏸' : '⬇'}
          </span>
          <span
            className={`text-[10px] font-bold ${
              downloadBlocked ? 'text-red-400' : downloadPaused ? 'text-amber-400' : 'text-vault-accent2'
            }`}
          >
            {downloadBlocked
              ? /disque insuffisant/i.test(downloadBlocked)
                ? 'DISQUE PLEIN'
                : 'BLOQUÉ'
              : downloadPaused
                ? downloadPct != null && downloadPct > 0
                  ? `${downloadPct}% · EN PAUSE`
                  : 'EN PAUSE'
                : downloadPct != null
                  ? `${downloadPct}%`
                  : 'TÉLÉCHARGEMENT'}
          </span>
        </div>
      )}
      {game.installed && !running && downloadPct === undefined && (
        <div className="absolute top-9 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-vault-accent2">
          ⬇ INSTALLÉ
        </div>
      )}
    </motion.button>
  )
}

/** Mémo : on ne re-rend que si l'objet jeu, l'état "en jeu" ou la progression de téléchargement change (callbacks supposés stables). */
const GameCard = memo(
  GameCardBase,
  (a, b) =>
    a.game === b.game &&
    a.running === b.running &&
    a.downloadPct === b.downloadPct &&
    a.downloadPaused === b.downloadPaused &&
    a.downloadBlocked === b.downloadBlocked &&
    a.onSelect === b.onSelect &&
    a.onOpenMenu === b.onOpenMenu
)

export default GameCard
