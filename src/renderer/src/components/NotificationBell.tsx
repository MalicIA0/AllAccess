import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { InstallProgressEvent } from '../../../shared/types'

/**
 * Cloche de notifications (barre de titre, en haut à droite).
 * Centre de notifications général de l'appli : pour l'instant alimenté par les fins
 * (et échecs) d'installation de jeux. Badge rouge = non-lues ; le panneau se déroule
 * sous la cloche ; ouvrir le panneau marque tout comme lu. Persisté en localStorage
 * pour survivre aux redémarrages (20 dernières).
 */

const STORE_KEY = 'notifCenter.v1'
const MAX_NOTIFS = 20

interface Notif {
  id: number
  icon: string
  title: string
  body: string
  at: number // timestamp ms
  read: boolean
}

function load(): Notif[] {
  try {
    const arr = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Notif[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function save(list: Notif[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX_NOTIFS)))
  } catch {
    /* quota — tant pis */
  }
}

function fmtWhen(at: number): string {
  const diff = Date.now() - at
  if (diff < 60_000) return 'à l’instant'
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`
  return new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

let notifId = Date.now()

export default function NotificationBell(): React.JSX.Element {
  const [notifs, setNotifs] = useState<Notif[]>(load)
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const unread = notifs.filter((n) => !n.read).length

  // Alimentation : fins / échecs d'installation (Steam, Xbox…) émis par le main process.
  useEffect(() => {
    return window.api.onInstallProgress((e: InstallProgressEvent) => {
      if (e.status === 'started') return // le toast suffit pour le démarrage
      const n: Notif =
        e.status === 'done'
          ? {
              id: ++notifId,
              icon: '✅',
              title: 'Installation terminée',
              body: `${e.gameName} est prêt à jouer`,
              at: Date.now(),
              read: false
            }
          : {
              id: ++notifId,
              icon: '⚠️',
              title: "Échec de l'installation",
              body: e.message ? `${e.gameName} — ${e.message}` : e.gameName,
              at: Date.now(),
              read: false
            }
      setNotifs((prev) => {
        const next = [n, ...prev].slice(0, MAX_NOTIFS)
        save(next)
        return next
      })
    })
  }, [])

  // Clic en dehors → ferme le panneau
  useEffect(() => {
    if (!open) return
    const onDown = (ev: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (): void => {
    setOpen((v) => {
      const opening = !v
      if (opening && unread > 0) {
        // ouvrir = tout marquer lu (le badge s'éteint, l'historique reste)
        setNotifs((prev) => {
          const next = prev.map((n) => ({ ...n, read: true }))
          save(next)
          return next
        })
      }
      return opening
    })
  }

  const clearAll = (): void => {
    setNotifs([])
    save([])
    setOpen(false)
  }

  return (
    <div className="relative h-full" ref={panelRef}>
      <button
        onClick={toggle}
        title="Notifications"
        className={`relative flex h-full w-12 items-center justify-center transition hover:bg-white/5 ${
          unread > 0 ? 'text-vault-accent2' : 'text-vault-muted hover:text-vault-text'
        }`}
      >
        <motion.svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-[18px] w-[18px] ${unread > 0 ? 'drop-shadow-[0_0_6px_currentColor]' : ''}`}
          style={{ originX: 0.5, originY: 0.1 }}
          animate={unread > 0 ? { rotate: [0, -14, 11, -8, 5, -3, 0] } : { rotate: 0 }}
          transition={unread > 0 ? { duration: 1, repeat: Infinity, repeatDelay: 2.2, ease: 'easeInOut' } : {}}
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </motion.svg>
        {unread > 0 && (
          <span className="absolute top-1 right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.8)]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass absolute top-full right-0 z-[80] mt-1 w-80 overflow-hidden rounded-2xl border border-vault-border shadow-2xl shadow-black/60"
          >
            <div className="flex items-center justify-between border-b border-vault-border/60 px-4 py-2.5">
              <p className="text-sm font-black tracking-tight">Notifications</p>
              {notifs.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs font-semibold text-vault-muted underline-offset-2 transition hover:text-vault-text hover:underline"
                >
                  Tout effacer
                </button>
              )}
            </div>

            {notifs.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-vault-muted">Rien pour le moment 💤</p>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {notifs.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 border-b border-vault-border/40 px-4 py-3 last:border-b-0">
                    <span className="mt-0.5 text-lg leading-none">{n.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{n.title}</p>
                      <p className="truncate text-xs text-vault-text/90">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-vault-muted">{fmtWhen(n.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
