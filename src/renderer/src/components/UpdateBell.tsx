import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { playUpdateAlarm } from '../lib/chimes'

/**
 * Sonnette d'alarme de mise à jour de l'overlay HW Monitor.
 * - Visible UNIQUEMENT quand la copie embarquée dans All Access diffère de la
 *   copie installée (détection par hash côté main : perf:updateCheck).
 * - Sonne (timbre exclusif, non configurable) une fois par lancement tant que
 *   la notification n'a pas été validée par OK.
 * - OK ne fait que VALIDER la notification (badge éteint) : rien ne s'installe
 *   automatiquement — la mise à jour s'applique depuis l'onglet Overlay.
 * - La validation est mémorisée par hash : une NOUVELLE mise à jour re-sonne.
 */

const ACK_KEY = 'perfUpdateAck'

type UpdateStatus = {
  installed: boolean
  updateAvailable: boolean
  embeddedHash: string
  embeddedDate?: string
  installedDate?: string
}

const fmtDate = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

export default function UpdateBell(): React.JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [acked, setAcked] = useState(true)
  const [open, setOpen] = useState(false)
  const rangFor = useRef<string | null>(null)

  const check = useCallback(async () => {
    const s = await window.api.checkPerfUpdate()
    setStatus(s)
    setAcked(localStorage.getItem(ACK_KEY) === s.embeddedHash)
  }, [])

  useEffect(() => {
    void check()
    // re-vérifie après une (ré)installation depuis l'onglet Overlay + toutes les 15 min
    const onInstalled = (): void => void check()
    window.addEventListener('perf-installed', onInstalled)
    const id = setInterval(() => void check(), 15 * 60_000)
    return () => {
      window.removeEventListener('perf-installed', onInstalled)
      clearInterval(id)
    }
  }, [check])

  // Alarme sonore : une fois par lancement et par version, tant que non validée.
  useEffect(() => {
    if (status?.updateAvailable && !acked && rangFor.current !== status.embeddedHash) {
      rangFor.current = status.embeddedHash
      playUpdateAlarm()
    }
  }, [status, acked])

  if (!status?.updateAvailable) return null

  const validate = (): void => {
    localStorage.setItem(ACK_KEY, status.embeddedHash)
    setAcked(true)
    setOpen(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Mise à jour de l'overlay disponible"
        className="relative flex h-full w-12 items-center justify-center text-vault-gold transition hover:bg-white/5"
      >
        <motion.svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-[18px] w-[18px] drop-shadow-[0_0_6px_currentColor]"
          style={{ originX: 0.5, originY: 0.1 }}
          animate={acked ? { rotate: 0 } : { rotate: [0, -18, 14, -10, 7, -4, 0] }}
          transition={acked ? {} : { duration: 1.1, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </motion.svg>
        {!acked && (
          <span className="absolute top-1 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white shadow-[0_0_8px_rgba(239,68,68,0.8)]">
            1
          </span>
        )}
      </button>

      {/* Notification modale — se valide par OK (aucune installation automatique) */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={validate}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="glass w-[420px] rounded-2xl border border-vault-gold/30 p-6 shadow-2xl shadow-black/60"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-vault-gold/15 text-2xl">🔔</span>
                <div>
                  <p className="text-base font-black tracking-tight">Mise à jour disponible</p>
                  <p className="text-xs text-vault-muted">Overlay Performances (HW Monitor)</p>
                </div>
              </div>

              <p className="mb-2 text-sm leading-relaxed text-vault-text">
                Une nouvelle version de l'overlay est prête dans All Access
                {status.embeddedDate && (
                  <>
                    {' '}
                    <span className="font-semibold">(version du {fmtDate(status.embeddedDate)})</span>
                  </>
                )}
                . Ta copie installée date du {fmtDate(status.installedDate)}.
              </p>
              <p className="mb-5 text-sm leading-relaxed text-vault-muted">
                Rien ne s'installe automatiquement : quand tu veux l'appliquer, va dans l'onglet{' '}
                <span className="font-semibold text-vault-text">Overlay</span> puis{' '}
                <span className="font-semibold text-vault-text">« ⟳ Réinstaller / mettre à jour »</span>.
              </p>

              <button
                onClick={validate}
                className="w-full rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 py-3 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98]"
              >
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
