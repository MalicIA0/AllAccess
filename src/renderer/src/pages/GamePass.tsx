import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { GamePassEntry, SteamPromos, SteamSpecial, XboxDeal } from '../../../shared/types'

type DeviceFilter = 'pc' | 'new' | 'deals'
type Source = 'gamepass' | 'steam'
type SteamView = 'catalog' | 'promos' | 'free'

const euros = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',') + ' €'

/**
 * Vignette Steam scrapée = une bannière large (231×87) — zoomée/mal cadrée si forcée dans une
 * jaquette 2:3. On préfère la vraie jaquette verticale du CDN Steam (même format que la
 * bibliothèque), avec la vignette scrapée en dernier secours si elle n'existe pas.
 */
function steamCoverSources(special: SteamSpecial): string[] {
  return [
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${special.appid}/library_600x900.jpg`,
    special.imageUrl
  ].filter((s, i, arr): s is string => !!s && arr.indexOf(s) === i)
}

function SpecialCard({ special, index }: { special: SteamSpecial; index: number }): React.JSX.Element {
  const sources = steamCoverSources(special)
  const [imgIdx, setImgIdx] = useState(0)
  const imgSrc = sources[imgIdx]

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.015, 0.35), duration: 0.3 }}
      whileHover={{ y: -6, scale: 1.03, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { type: 'tween', duration: 0.1 } }}
      onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${special.appid}`)}
      className="group relative aspect-[2/3] overflow-hidden rounded-2xl bg-vault-card text-left shadow-lg shadow-black/40 ring-1 ring-vault-border/60 transition-colors duration-150 ease-out hover:ring-[#66c0f4]/60"
    >
      {imgSrc ? (
        <img
          src={imgSrc}
          alt={special.name}
          loading="lazy"
          onError={() => setImgIdx(imgIdx + 1)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-vault-card to-vault-panel p-3 text-center">
          <span className="text-sm font-bold text-vault-muted">{special.name}</span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-bold">{special.name}</p>
        <div className="mt-1 flex items-center gap-2">
          {special.free ? (
            <span className="text-xs font-black text-emerald-400">Gratuit</span>
          ) : (
            <>
              {special.discountPercent > 0 && (
                <span className="text-[10px] font-semibold text-vault-muted line-through">
                  {euros(special.originalPriceCents)}
                </span>
              )}
              <span className="text-xs font-black text-emerald-400">{euros(special.finalPriceCents)}</span>
            </>
          )}
        </div>
      </div>

      {special.discountPercent > 0 && (
        <span className="absolute inset-x-2 top-2 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
          -{special.discountPercent}%
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center opacity-0 transition group-hover:opacity-100">
        <span className="rounded-full bg-black/75 px-3 py-1 text-[11px] font-bold text-white shadow-lg">
          🔗 Voir sur Steam
        </span>
      </div>
    </motion.button>
  )
}

/** Carte d'un jeu Xbox/Microsoft Store en promo — même gabarit que les cartes Steam. */
function XboxDealCard({ deal, index }: { deal: XboxDeal; index: number }): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.015, 0.35), duration: 0.3 }}
      whileHover={{ y: -6, scale: 1.03, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { type: 'tween', duration: 0.1 } }}
      onClick={() => void window.api.openExternal(`https://www.xbox.com/fr-FR/games/store/x/${deal.productId}`)}
      className="group relative aspect-[2/3] overflow-hidden rounded-2xl bg-vault-card text-left shadow-lg shadow-black/40 ring-1 ring-vault-border/60 transition-colors duration-150 ease-out hover:ring-emerald-400/60"
    >
      {deal.imageUrl && !imgFailed ? (
        <img
          src={deal.imageUrl}
          alt={deal.title}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-vault-card to-vault-panel p-3 text-center">
          <span className="text-sm font-bold text-vault-muted">{deal.title}</span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-bold">{deal.title}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] font-semibold text-vault-muted line-through">{euros(deal.originalPriceCents)}</span>
          <span className="text-xs font-black text-emerald-400">{euros(deal.finalPriceCents)}</span>
          <span className="ml-auto text-[10px] font-semibold text-vault-muted">
            {deal.pc && deal.console ? '💻 · 🎮' : deal.pc ? '💻 PC' : '🎮 Console'}
          </span>
        </div>
      </div>

      {deal.discountPercent > 0 && (
        <span className="absolute inset-x-2 top-2 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
          -{deal.discountPercent}%
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center opacity-0 transition group-hover:opacity-100">
        <span className="rounded-full bg-black/75 px-3 py-1 text-[11px] font-bold text-white shadow-lg">
          🔗 Voir sur le Store
        </span>
      </div>
    </motion.button>
  )
}

/** Bannière spotlight pour l'offre du jour — mise en avant, distincte de la grille des offres de la semaine. */
function DailyDealBanner({ special }: { special: SteamSpecial }): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <motion.button
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => void window.api.openExternal(`https://store.steampowered.com/app/${special.appid}`)}
      className="group relative mb-6 flex w-full items-center gap-5 overflow-hidden rounded-2xl border border-vault-gold/40 bg-vault-card text-left shadow-lg shadow-black/40 transition hover:border-vault-gold/70"
    >
      <div className="relative h-28 w-48 shrink-0 overflow-hidden">
        {special.imageUrl && !imgFailed ? (
          <img
            src={special.imageUrl}
            alt={special.name}
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-vault-card to-vault-panel" />
        )}
      </div>
      <div className="min-w-0 flex-1 py-3 pr-5">
        <span className="mb-1 inline-block rounded-md bg-vault-gold/90 px-2 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
          ⭐ OFFRE EXCEPTIONNELLE DU JOUR
        </span>
        <p className="truncate text-lg font-black">{special.name}</p>
        <div className="mt-1 flex items-center gap-3">
          <span className="rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-xs font-black text-black shadow">
            -{special.discountPercent}%
          </span>
          <span className="text-sm font-semibold text-vault-muted line-through">{euros(special.originalPriceCents)}</span>
          <span className="text-base font-black text-emerald-400">{euros(special.finalPriceCents)}</span>
        </div>
      </div>
    </motion.button>
  )
}

function EntryCard({
  entry,
  index,
  onOpen,
  onSelectLibrary
}: {
  entry: GamePassEntry
  index: number
  onOpen: () => void
  onSelectLibrary: (() => void) | null
}): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)
  const src = !imgFailed ? (entry.poster ?? entry.hero) : entry.hero !== entry.poster ? entry.hero : null

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.015, 0.35), duration: 0.3 }}
      whileHover={{ y: -6, scale: 1.03, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { type: 'tween', duration: 0.1 } }}
      // installé → jouer ; déjà en bibliothèque → ouvrir la fiche (succès) ; sinon → installer
      onClick={entry.installed ? onOpen : (onSelectLibrary ?? onOpen)}
      className="group relative aspect-[2/3] overflow-hidden rounded-2xl bg-vault-card text-left shadow-lg shadow-black/40 ring-1 ring-vault-border/60 transition-colors duration-150 ease-out hover:ring-emerald-400/60"
    >
      {src ? (
        <img
          src={src}
          alt={entry.title}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-vault-card to-vault-panel p-3 text-center">
          <span className="text-sm font-bold text-vault-muted">{entry.title}</span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-bold">{entry.title}</p>
        <p className="mt-0.5 text-[10px] font-semibold text-vault-muted">
          {entry.pc && entry.console ? '💻 PC · 🎮 Console' : entry.pc ? '💻 PC' : '🎮 Console'}
        </p>
      </div>

      <div className="absolute inset-x-2 top-2 flex items-start justify-between gap-1">
        <span className="rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black shadow">
          GAME PASS
        </span>
        {entry.installed ? (
          <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-vault-accent2">
            ⬇ INSTALLÉ
          </span>
        ) : entry.inLibrary ? (
          <span className="rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-vault-gold">★ JOUÉ</span>
        ) : null}
      </div>

      {/* action au survol */}
      <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center opacity-0 transition group-hover:opacity-100">
        <span className="rounded-full bg-black/75 px-3 py-1 text-[11px] font-bold text-white shadow-lg">
          {entry.installed ? '▶ Jouer' : entry.inLibrary ? 'Voir la fiche' : '⬇ Installer'}
        </span>
      </div>
    </motion.button>
  )
}

/** Carte « Voir plus » en fin de grille — ouvre directement l'appli native (Xbox/Game Pass ou Steam). */
function SeeMoreCard({
  label,
  ringClass,
  onClick
}: {
  label: string
  ringClass: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <motion.button
      whileHover={{ y: -6, scale: 1.03, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { type: 'tween', duration: 0.1 } }}
      onClick={onClick}
      className={`group flex aspect-[2/3] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-vault-card/40 p-4 text-center transition ${ringClass}`}
    >
      <span className="text-4xl transition group-hover:scale-110">➕</span>
      <span className="text-sm font-bold text-vault-text">{label}</span>
      <span className="text-[11px] font-semibold text-vault-muted">Ouvrir l'appli →</span>
    </motion.button>
  )
}

export default function GamePass({
  connected,
  onSelectLibraryGame
}: {
  connected: boolean
  onSelectLibraryGame: (id: string) => void
}): React.JSX.Element {
  const [entries, setEntries] = useState<GamePassEntry[] | null>(null)
  const [recent, setRecent] = useState<GamePassEntry[] | null>(null)
  const [promos, setPromos] = useState<SteamPromos | null>(null)
  const [steamCatalog, setSteamCatalog] = useState<SteamSpecial[] | null>(null)
  const [steamFree, setSteamFree] = useState<SteamSpecial[] | null>(null)
  const [xboxDeals, setXboxDeals] = useState<XboxDeal[] | null>(null)
  const [search, setSearch] = useState('')
  const [device, setDevice] = useState<DeviceFilter>('pc')
  const [source, setSource] = useState<Source>('gamepass')
  const [steamView, setSteamView] = useState<SteamView>('catalog')
  // Sous-filtre de la vue « Promo Steam » : promos payantes vs jeux offerts (‑100 % à garder).
  const [promoKind, setPromoKind] = useState<'paid' | 'free'>('paid')

  useEffect(() => {
    void window.api.getGamePassCatalog().then(setEntries)
    void window.api.getGamePassRecent().then(setRecent)
    void window.api.getSteamPromos().then(setPromos)
    void window.api.getSteamCatalog().then(setSteamCatalog)
    void window.api.getSteamFreeGames().then(setSteamFree)
    void window.api.getXboxDeals().then(setXboxDeals)
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const source_ = device === 'new' ? recent : entries
    if (!source_) return []
    return source_.filter((e) => {
      if (q && !e.title.toLowerCase().includes(q)) return false
      if (device === 'pc' && !e.pc) return false
      return true
    })
  }, [entries, recent, search, device])

  const filteredSpecials = useMemo(() => {
    if (!promos)
      return {
        dailyDeal: null as SteamSpecial | null,
        weekly: [] as SteamSpecial[],
        becomeFree: [] as SteamSpecial[]
      }
    const q = search.toLowerCase().trim()
    const dailyDeal = promos.dailyDeal && (!q || promos.dailyDeal.name.toLowerCase().includes(q)) ? promos.dailyDeal : null
    const weekly = promos.weekly.filter((s) => !q || s.name.toLowerCase().includes(q))
    const becomeFree = promos.becomeFree.filter((s) => !q || s.name.toLowerCase().includes(q))
    return { dailyDeal, weekly, becomeFree }
  }, [promos, search])

  const filteredCatalog = useMemo(() => {
    if (!steamCatalog) return []
    const q = search.toLowerCase().trim()
    return steamCatalog.filter((s) => !q || s.name.toLowerCase().includes(q))
  }, [steamCatalog, search])

  const filteredFree = useMemo(() => {
    if (!steamFree) return []
    const q = search.toLowerCase().trim()
    return steamFree.filter((s) => !q || s.name.toLowerCase().includes(q))
  }, [steamFree, search])

  const filteredXboxDeals = useMemo(() => {
    if (!xboxDeals) return []
    const q = search.toLowerCase().trim()
    return xboxDeals.filter((d) => !q || d.title.toLowerCase().includes(q))
  }, [xboxDeals, search])

  const chip = (active: boolean): string =>
    `rounded-full px-4 py-1.5 text-xs font-semibold transition ${
      active
        ? 'bg-emerald-500/20 text-vault-text border border-emerald-400/50'
        : 'border border-vault-border text-vault-muted hover:border-emerald-400/40 hover:text-vault-text'
    }`

  const listIsLoading = device === 'new' ? recent === null : device === 'deals' ? xboxDeals === null : entries === null

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-3xl font-black tracking-tight">
          <span className="text-emerald-400">Catalogue</span>{' '}
          <span className="ml-2 align-middle text-sm font-semibold text-vault-muted">
            {source === 'gamepass'
              ? device === 'deals'
                ? `${filteredXboxDeals.length} offres`
                : `${filtered.length} jeux`
              : steamView === 'catalog'
                ? `${filteredCatalog.length} jeux`
                : steamView === 'free'
                  ? `${filteredFree.length} jeux`
                  : `${filteredSpecials.weekly.length + (filteredSpecials.dailyDeal ? 1 : 0)} offres`}
          </span>
        </h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher dans le catalogue…"
          className="glass w-64 rounded-xl px-4 py-2 text-sm outline-none placeholder:text-vault-muted focus:border-emerald-400/50"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className={chip(source === 'gamepass')} onClick={() => setSource('gamepass')}>🟢 Game Pass</button>
        <button className={chip(source === 'steam')} onClick={() => setSource('steam')}>🎮 Steam</button>
      </div>

      {source === 'gamepass' ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <button className={chip(device === 'pc')} onClick={() => setDevice('pc')}>💻 PC Game Pass</button>
            <button className={chip(device === 'new')} onClick={() => setDevice('new')}>🆕 Dernières sorties</button>
            <button className={chip(device === 'deals')} onClick={() => setDevice('deals')}>🔥 Promos</button>
            {!connected && (
              <span className="ml-auto text-xs text-vault-muted">
                Catalogue public — connecte ton compte Xbox dans les Réglages pour installer en un clic.
              </span>
            )}
          </div>
          {device === 'new' && (
            <p className="-mt-3 mb-5 text-xs text-vault-muted">
              La collection officielle « Ajouts récents » de Xbox — les derniers jeux offerts par l'abonnement.
            </p>
          )}
          {device === 'deals' && (
            <p className="-mt-3 mb-5 text-xs text-vault-muted">
              Les offres du moment sur le Store Xbox — mêmes promos que la page « Offres sur les jeux » de xbox.com.
            </p>
          )}

          {listIsLoading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5">
              {Array.from({ length: 14 }, (_, i) => (
                <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />
              ))}
            </div>
          ) : device === 'deals' ? (
            filteredXboxDeals.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <p className="text-5xl">📡</p>
                <h2 className="text-xl font-bold">Promos indisponibles</h2>
                <p className="max-w-md text-sm text-vault-muted">
                  Impossible de récupérer les offres du Store Xbox pour l'instant — vérifie ta connexion Internet puis
                  réessaie.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5 pb-8">
                {filteredXboxDeals.map((d, i) => (
                  <XboxDealCard key={d.productId} deal={d} index={i} />
                ))}
                <SeeMoreCard
                  label="Toutes les offres Xbox"
                  ringClass="border-emerald-400/40 hover:border-emerald-400/80"
                  onClick={() =>
                    void window.api.openExternal('https://www.xbox.com/fr-FR/games/browse/DynamicChannel.GameDeals')
                  }
                />
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-24 text-center">
              <p className="text-5xl">📡</p>
              <h2 className="text-xl font-bold">Catalogue indisponible</h2>
              <p className="max-w-md text-sm text-vault-muted">
                Impossible de récupérer le catalogue Game Pass pour l'instant — vérifie ta connexion Internet puis
                réessaie.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5 pb-8">
              {filtered.map((e, i) => (
                <EntryCard
                  key={e.productId}
                  entry={e}
                  index={i}
                  onOpen={() => void window.api.openGamePassGame(e.productId, e.title)}
                  onSelectLibrary={e.libraryGameId ? () => onSelectLibraryGame(e.libraryGameId!) : null}
                />
              ))}
              <SeeMoreCard
                label="Voir plus sur Game Pass"
                ringClass="border-emerald-400/40 hover:border-emerald-400/80"
                onClick={() => void window.api.openGamePassApp()}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-2">
            <button className={chip(steamView === 'catalog')} onClick={() => setSteamView('catalog')}>📚 Catalogue</button>
            <button className={chip(steamView === 'promos')} onClick={() => setSteamView('promos')}>🔥 Promo Steam</button>
            <button className={chip(steamView === 'free')} onClick={() => setSteamView('free')}>🆓 Gratuits</button>
          </div>

          {steamView === 'catalog' ? (
            steamCatalog === null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5">
                {Array.from({ length: 14 }, (_, i) => (
                  <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />
                ))}
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <p className="text-5xl">📡</p>
                <h2 className="text-xl font-bold">Catalogue indisponible</h2>
                <p className="max-w-md text-sm text-vault-muted">
                  Impossible de récupérer le catalogue Steam pour l'instant — vérifie ta connexion Internet puis
                  réessaie.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5 pb-8">
                {filteredCatalog.map((s, i) => (
                  <SpecialCard key={s.appid} special={s} index={i} />
                ))}
                <SeeMoreCard
                  label="Voir plus sur Steam"
                  ringClass="border-[#66c0f4]/40 hover:border-[#66c0f4]/80"
                  onClick={() => void window.api.openSteamStore('catalog')}
                />
              </div>
            )
          ) : steamView === 'free' ? (
            steamFree === null ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5">
                {Array.from({ length: 14 }, (_, i) => (
                  <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />
                ))}
              </div>
            ) : filteredFree.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-24 text-center">
                <p className="text-5xl">🆓</p>
                <h2 className="text-xl font-bold">Liste indisponible</h2>
                <p className="max-w-md text-sm text-vault-muted">
                  Impossible de récupérer les jeux gratuits Steam pour l'instant — vérifie ta connexion Internet puis
                  réessaie.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5 pb-8">
                {filteredFree.map((s, i) => (
                  <SpecialCard key={s.appid} special={s} index={i} />
                ))}
                <SeeMoreCard
                  label="Voir plus sur Steam"
                  ringClass="border-[#66c0f4]/40 hover:border-[#66c0f4]/80"
                  onClick={() => void window.api.openSteamStore('catalog')}
                />
              </div>
            )
          ) : promos === null ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5">
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="skeleton aspect-[2/3] rounded-2xl" />
              ))}
            </div>
          ) : (
            <>
              {/* Sous-filtre : promos payantes vs jeux payants offerts (‑100 %, à garder). */}
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <button className={chip(promoKind === 'paid')} onClick={() => setPromoKind('paid')}>
                  💸 Payantes <span className="opacity-70">· {filteredSpecials.weekly.length}</span>
                </button>
                <button className={chip(promoKind === 'free')} onClick={() => setPromoKind('free')}>
                  🎁 Offerts à garder <span className="opacity-70">· {filteredSpecials.becomeFree.length}</span>
                </button>
              </div>

              {promoKind === 'free' ? (
                filteredSpecials.becomeFree.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-24 text-center">
                    <p className="text-5xl">🎁</p>
                    <h2 className="text-xl font-bold">Aucun jeu offert en ce moment</h2>
                    <p className="max-w-md text-sm text-vault-muted">
                      Ici apparaissent les jeux normalement payants offerts à ‑100 % (à récupérer et garder
                      définitivement). C'est occasionnel — repasse pendant les soldes et week-ends gratuits.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5 pb-8">
                    {filteredSpecials.becomeFree.map((s, i) => (
                      <SpecialCard key={s.appid} special={s} index={i} />
                    ))}
                    <SeeMoreCard
                      label="Toutes les offres Steam"
                      ringClass="border-[#66c0f4]/40 hover:border-[#66c0f4]/80"
                      onClick={() => void window.api.openSteamStore('promos')}
                    />
                  </div>
                )
              ) : filteredSpecials.weekly.length === 0 && !filteredSpecials.dailyDeal ? (
                <div className="flex flex-col items-center gap-3 py-24 text-center">
                  <p className="text-5xl">📡</p>
                  <h2 className="text-xl font-bold">Promos indisponibles</h2>
                  <p className="max-w-md text-sm text-vault-muted">
                    Impossible de récupérer les offres Steam du moment — vérifie ta connexion Internet puis réessaie.
                  </p>
                </div>
              ) : (
                <>
                  {filteredSpecials.dailyDeal && <DailyDealBanner special={filteredSpecials.dailyDeal} />}
                  <p className="mb-4 text-sm font-semibold">
                    Offres de la semaine{' '}
                    <span className="font-normal text-vault-muted">· {filteredSpecials.weekly.length}</span>
                  </p>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--card-min,160px),1fr))] gap-5 pb-8">
                    {filteredSpecials.weekly.map((s, i) => (
                      <SpecialCard key={s.appid} special={s} index={i} />
                    ))}
                    <SeeMoreCard
                      label="Toutes les offres Steam"
                      ringClass="border-[#66c0f4]/40 hover:border-[#66c0f4]/80"
                      onClick={() => void window.api.openSteamStore('promos')}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
