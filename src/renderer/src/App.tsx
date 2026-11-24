import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type {
  AchievementUnlockedEvent,
  AppSettings,
  AuthStatus,
  Game,
  GameSessionEvent,
  InstallProgressEvent,
  SyncProgress
} from '../../shared/types'
import Titlebar from './components/Titlebar'
import Sidebar, { type PageId } from './components/Sidebar'
import AmbientBackground from './components/AmbientBackground'
import Library, { type OwnershipFilter } from './pages/Library'
import Downloads from './pages/Downloads'
import GamePass from './pages/GamePass'
import Friends from './pages/Friends'
import Messages from './pages/Messages'
import Apps from './pages/Apps'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import OverlayPage from './pages/OverlayPage'
import HdrPage from './pages/HdrPage'
import GameDetail from './pages/GameDetail'
import { playChime } from './lib/chimes'

/**
 * Rang de rareté (0→5) à partir du pourcentage — même barème que la bannière overlay.
 * Sert à choisir la richesse du carillon.
 */
function rankForRarity(rarity: number | null): number {
  if (rarity == null) return 0
  if (rarity >= 50) return 1
  if (rarity >= 20) return 2
  if (rarity >= 10) return 3
  if (rarity >= 5) return 4
  return 5
}

/** Applique les réglages visuels via des attributs data-* (thème, fond, taille des cartes). */
function applyVisualSettings(s: AppSettings): void {
  const el = document.documentElement
  el.dataset.theme = s.theme || 'nebula'
  el.dataset.bg = s.bgMode
  el.dataset.cards = s.cardSize
}

interface Toast {
  id: number
  title: string
  body: string
}

let toastId = 0

export default function App(): React.JSX.Element {
  const [page, setPage] = useState<PageId>('library')
  const [libraryOwnership, setLibraryOwnership] = useState<OwnershipFilter>('all')
  const [games, setGames] = useState<Game[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncProgress | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set())
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [friendsCount, setFriendsCount] = useState<{ online: number; total: number } | null>(null)

  const onSettingsChanged = useCallback((s: AppSettings) => {
    setSettings(s)
    applyVisualSettings(s)
  }, [])

  const refreshAuth = useCallback(async () => {
    setAuth(await window.api.getAuthStatus())
  }, [])

  const loadLibrary = useCallback(async () => {
    setGames(await window.api.getLibrary())
  }, [])

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId
    setToasts((prev) => [...prev.slice(-3), { ...t, id }])
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 7000)
  }, [])

  useEffect(() => {
    void loadLibrary()
    // applique thème + fond + interface dès l'ouverture
    void window.api.getSettings().then((s) => {
      setSettings(s)
      applyVisualSettings(s)
      // reconnecte Steam/Xbox/Epic (jetons stockés) + relance la bibliothèque, sans action de l'utilisateur
      if (s.autoSyncOnLaunch) {
        setSync({ phase: 'Démarrage', detail: '…', done: false })
        void window.api.runSync()
      }
    })
    void refreshAuth()
    const offs = [
      window.api.onSyncProgress((p) => {
        setSync(p)
        if (p.done) {
          setTimeout(() => setSync(null), 4000)
          void loadLibrary()
          void refreshAuth()
        }
      }),
      window.api.onLibraryChanged(() => void loadLibrary()),
      // Le VISUEL du succès est affiché par l'overlay animé bas-centre (voir overlay.ts).
      // Le SON, lui, est joué ici : la fenêtre principale est une fenêtre normale où WebAudio est
      // stable, alors que l'overlay (transparent/non-focusable) plante si on y crée un AudioContext.
      window.api.onAchievementUnlocked((e: AchievementUnlockedEvent) => {
        void loadLibrary()
        void window.api.getSettings().then((s) => {
          if (!s.notifSound) return
          const vol = Math.max(0, Math.min(100, s.chimeVolume ?? 60)) / 100
          if (vol > 0) playChime(s.chimeStyle ?? 'cristal', rankForRarity(e.achievement.rarity), vol)
        })
      }),
      window.api.onInstallProgress((e: InstallProgressEvent) => {
        if (e.status === 'started') {
          pushToast({ title: 'Installation lancée', body: e.gameName })
        } else if (e.status === 'done') {
          pushToast({ title: '✅ Installation terminée', body: e.gameName })
        } else {
          pushToast({
            title: "⚠️ Échec de l'installation",
            body: e.message ? `${e.gameName} — ${e.message}` : e.gameName
          })
        }
      }),
      window.api.onGameSession((e: GameSessionEvent) => {
        setRunningIds((prev) => {
          const next = new Set(prev)
          e.running ? next.add(e.gameId) : next.delete(e.gameId)
          return next
        })
        pushToast({
          title: e.running ? 'Session démarrée' : 'Session terminée',
          body: e.gameName
        })
      }),
      window.api.onTraySync(() => void window.api.runSync())
    ]
    return () => offs.forEach((off) => off())
  }, [loadLibrary, pushToast, refreshAuth])

  // Resynchronise périodiquement pendant que l'appli reste ouverte (ex. un jeu Steam qui finit de
  // télécharger) — sans ça, la connexion automatique n'agissait qu'une fois, au lancement.
  useEffect(() => {
    if (!settings?.autoSyncOnLaunch) return
    const interval = setInterval(() => {
      void window.api.isSyncing().then((busy) => {
        if (!busy) void window.api.runSync()
      })
    }, 10 * 60_000)
    return () => clearInterval(interval)
  }, [settings?.autoSyncOnLaunch])

  // Rescan LOCAL de l'état « installé » (fichiers .acf Steam + menu Démarrer Xbox, zéro réseau)
  // toutes les 90 s : un jeu qu'on vient d'installer apparaît de lui-même en < 1,5 min, sans
  // attendre la grosse sync réseau (10 min) ni dépendre du suivi de téléchargement. Le main émet
  // « library:changed » si quelque chose a bougé → la bibliothèque se recharge (voir plus haut).
  useEffect(() => {
    const interval = setInterval(() => {
      void window.api.isSyncing().then((busy) => {
        if (!busy) void window.api.refreshInstalled()
      })
    }, 90_000)
    return () => clearInterval(interval)
  }, [])

  // Compteur « en ligne / total » affiché à côté de « Amis » dans la sidebar — indépendant de la
  // page Amis (qui a son propre suivi de session par ami), pour rester à jour même quand on n'est
  // pas sur cette page.
  const connected = (auth?.steam.connected ?? false) || (auth?.xbox.connected ?? false)
  useEffect(() => {
    if (!connected) {
      setFriendsCount(null)
      return
    }
    let cancelled = false
    const load = (): void => {
      void window.api.getFriends().then((r) => {
        if (cancelled) return
        setFriendsCount({ online: r.friends.filter((f) => f.online).length, total: r.friends.length })
      })
    }
    load()
    const minutes = Math.max(1, settings?.pollFriendsMin || 15)
    const id = setInterval(load, minutes * 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [connected, settings?.pollFriendsMin])

  // Pastille « N téléchargements » de la sidebar : visible depuis n'importe quelle page, donc
  // sondée ici. Cadence lente (8 s) et état réduit à un NOMBRE — la page Téléchargements, elle,
  // sonde à la seconde, mais elle seule doit se re-rendre à ce rythme.
  const [downloadCount, setDownloadCount] = useState(0)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.api
        .getActiveDownloads()
        .then((l) => alive && setDownloadCount(l.length))
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const startSync = useCallback(() => {
    setSync({ phase: 'Démarrage', detail: '…', done: false })
    void window.api.runSync()
  }, [])

  const goToLibrary = useCallback((filter: OwnershipFilter) => {
    setLibraryOwnership(filter)
    setPage('library')
  }, [])

  return (
    <>
      {/* particules derrière toute l'UI (le conteneur ci-dessous est en z-10) */}
      {settings && (
        <AmbientBackground
          mode={settings.bgMode}
          theme={settings.theme}
          speed={settings.bgSpeed}
        />
      )}
      <div className="relative z-10 flex h-full flex-col">
        <Titlebar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          page={page}
          onNavigate={setPage}
          sync={sync}
          friendsCount={friendsCount}
          downloadCount={downloadCount}
        />
        <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          {page === 'library' && (
            <Library
              games={games}
              runningIds={runningIds}
              onSelect={setSelectedId}
              onSync={startSync}
              ownership={libraryOwnership}
              onOwnershipChange={setLibraryOwnership}
            />
          )}
          {page === 'downloads' && <Downloads games={games} onSelect={setSelectedId} />}
          {page === 'amis' && <Friends connected={connected} />}
          {page === 'messages' && <Messages />}
          {page === 'gamepass' && (
            <GamePass connected={auth?.xbox.connected ?? false} onSelectLibraryGame={setSelectedId} />
          )}
          {page === 'apps' && <Apps onSync={startSync} />}
          {page === 'dashboard' && <Dashboard games={games} onSelect={setSelectedId} onNavigateLibrary={goToLibrary} />}
          {page === 'settings' && <Settings onSaved={startSync} onSettingsChanged={onSettingsChanged} />}
          {page === 'overlay' && <OverlayPage />}
          {page === 'hdr' && <HdrPage />}
        </main>
      </div>

      {/* Fiche jeu en overlay */}
      <AnimatePresence>
        {selectedId && (
          <GameDetail
            key={selectedId}
            gameId={selectedId}
            running={runningIds.has(selectedId)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </AnimatePresence>

      {/* Toasts in-app */}
      <div className="pointer-events-none fixed right-6 bottom-6 z-50 flex flex-col gap-3">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 80, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              className="glass flex w-80 items-center gap-3 rounded-2xl p-3 shadow-2xl shadow-black/50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-vault-accent/15 text-2xl">🎮</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-vault-gold">{t.title}</p>
                <p className="truncate text-sm text-vault-text">{t.body}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        </div>
      </div>
    </>
  )
}
