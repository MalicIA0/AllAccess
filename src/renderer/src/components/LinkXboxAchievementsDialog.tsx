import { useState } from 'react'
import { motion } from 'framer-motion'

export default function LinkXboxAchievementsDialog({
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
  onConfirm: (urlOrId: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')

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
        className="glass w-full max-w-md rounded-2xl p-6"
      >
        <h3 className="mb-2 text-lg font-bold">🎮 Ajouter les succès Xbox de « {gameName} »</h3>
        {message ? (
          <p className="mb-5 text-sm text-vault-green">{message}</p>
        ) : (
          <>
            <p className="mb-4 text-sm text-vault-muted">
              Colle le lien de la fiche Xbox/Microsoft Store du jeu (ou son identifiant produit).
              La liste complète des succès Xbox sera ajoutée à ce jeu, à cocher toi-même au fil de ta
              progression — <b>suivi 100 % local</b>, jamais envoyé ni synchronisé avec ton vrai compte
              Xbox.
            </p>
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim() && !busy) onConfirm(value.trim())
              }}
              placeholder="https://www.xbox.com/fr-fr/games/store/.../9NWQ1Q1FR0C9"
              className="glass mb-4 w-full rounded-xl px-3 py-2 text-sm outline-none placeholder:text-vault-muted/60"
            />
            <div className="flex gap-2">
              <button
                disabled={busy || !value.trim()}
                onClick={() => onConfirm(value.trim())}
                className="flex-1 rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 disabled:opacity-50"
              >
                {busy ? 'Recherche…' : 'Ajouter'}
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
