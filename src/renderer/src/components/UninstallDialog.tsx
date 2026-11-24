import { motion } from 'framer-motion'

export default function UninstallDialog({
  gameName,
  busy,
  error,
  message,
  onConfirm,
  onCancel
}: {
  gameName: string
  busy: boolean
  error: string | null
  message: string | null
  onConfirm: (deleteSave: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 20, scale: 0.97, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 20, scale: 0.97, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-sm rounded-2xl p-6"
      >
        <h3 className="mb-2 text-lg font-bold">Désinstaller « {gameName} » ?</h3>
        {message ? (
          <p className="mb-5 text-sm text-vault-green">{message}</p>
        ) : (
          <>
            <p className="mb-5 text-sm text-vault-muted">
              Le jeu sera retiré de ce PC. Que veux-tu faire de sa sauvegarde locale ?
            </p>
            <div className="flex flex-col gap-2">
              <button
                disabled={busy}
                onClick={() => onConfirm(false)}
                className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? 'Désinstallation…' : '🗂 Désinstaller et garder ma sauvegarde'}
              </button>
              <button
                disabled={busy}
                onClick={() => onConfirm(true)}
                className="rounded-xl border border-red-400/40 px-4 py-2.5 text-sm font-bold text-red-400 transition hover:bg-red-400/10 disabled:opacity-50"
              >
                {busy ? 'Désinstallation…' : '🗑 Désinstaller et supprimer la sauvegarde'}
              </button>
              <button
                disabled={busy}
                onClick={onCancel}
                className="rounded-xl border border-vault-border px-4 py-2.5 text-sm font-semibold text-vault-muted transition hover:text-vault-text disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {message && (
          <button
            onClick={onCancel}
            className="mt-4 w-full rounded-xl border border-vault-border px-4 py-2.5 text-sm font-semibold text-vault-muted transition hover:text-vault-text"
          >
            Fermer
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}
