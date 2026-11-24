import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * Sous-appli « HDR » — bascule le HDR de Windows (advanced color) en un clic, sans
 * passer par les Réglages Windows. Agit sur tous les écrans HDR-compatibles via le
 * même P/Invoke CCD que HW Monitor (voir ipc.ts). Aucun droit admin requis.
 */
export default function HdrPage(): React.JSX.Element {
  const [hdr, setHdr] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.api.getHdrStatus().then(setHdr)
  }, [])

  const apply = async (on: boolean): Promise<void> => {
    setBusy(true)
    setHdr(await window.api.setHdr(on))
    setBusy(false)
  }

  const supported = hdr?.supported ?? false
  const enabled = hdr?.enabled ?? false

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-3xl font-black tracking-tight">HDR Windows</h1>
      <p className="mb-8 text-sm text-vault-muted">
        Active ou coupe le HDR (High Dynamic Range) de Windows sur tes écrans compatibles, sans ouvrir les Réglages.
        Idéal juste avant de lancer un jeu HDR, puis pour le recouper ensuite.
      </p>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass overflow-hidden rounded-2xl border border-vault-accent/30 p-8"
      >
        {/* État courant */}
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            key={enabled ? 'on' : 'off'}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className={`flex h-24 w-24 items-center justify-center rounded-3xl text-5xl shadow-lg transition-colors ${
              enabled
                ? 'bg-gradient-to-br from-vault-accent to-vault-accent2 shadow-vault-accent/30'
                : 'bg-white/5 shadow-black/40'
            }`}
          >
            🌈
          </motion.div>
          <p className="mt-4 text-lg font-bold">
            {hdr == null ? (
              'Vérification…'
            ) : !supported ? (
              <span className="text-vault-muted">HDR non disponible</span>
            ) : enabled ? (
              <span className="text-vault-gold">HDR activé</span>
            ) : (
              <span className="text-vault-muted">HDR désactivé</span>
            )}
          </p>
          {hdr != null && !supported && (
            <p className="mt-1 max-w-sm text-xs text-vault-muted">
              Aucun écran compatible HDR n'a été détecté sur ce PC.
            </p>
          )}
        </div>

        {/* Boutons Activer / Désactiver */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => void apply(true)}
            disabled={busy || !supported || enabled}
            className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? '…' : '✦ Activer le HDR'}
          </button>
          <button
            onClick={() => void apply(false)}
            disabled={busy || !supported || !enabled}
            className="rounded-xl border border-vault-border px-6 py-4 text-sm font-bold text-vault-text transition hover:border-vault-accent/50 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? '…' : '○ Désactiver le HDR'}
          </button>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-vault-muted">
          ℹ️ L'écran peut clignoter brièvement au changement — c'est normal. L'état <b>HDR on/off</b> est aussi affiché
          en direct dans l'overlay HW Monitor (clique dessus pour le couper depuis l'overlay).
        </p>
      </motion.section>

      {/* Réglages fins : boutons vers les vrais outils Windows (nits/noirs/couleurs ne sont
          pas pilotables par une appli — c'est Windows/le moniteur qui les gère). */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06 }}
        className="glass mt-5 rounded-2xl border border-vault-border p-6"
      >
        <p className="mb-1 text-sm font-bold text-vault-text">Régler les noirs, la luminosité, les couleurs</p>
        <p className="mb-3 text-[11px] text-vault-muted">
          Le réglage fin du HDR (nits, niveaux de noir, couleurs) se fait dans les outils officiels de Windows :
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void window.api.openHdrCalibration()}
            className="rounded-lg border border-vault-border px-3 py-2 text-xs font-semibold text-vault-text transition hover:border-vault-accent/50 hover:bg-white/5"
          >
            🎚️ Calibration HDR Windows
          </button>
          <button
            onClick={() => void window.api.openHdrSettings()}
            className="rounded-lg border border-vault-border px-3 py-2 text-xs font-semibold text-vault-text transition hover:border-vault-accent/50 hover:bg-white/5"
          >
            ⚙️ Réglages HDR Windows
          </button>
          <button
            onClick={() => void window.api.openHdrColorMgmt()}
            className="rounded-lg border border-vault-border px-3 py-2 text-xs font-semibold text-vault-text transition hover:border-vault-accent/50 hover:bg-white/5"
          >
            🎨 Gestion des couleurs
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-vault-muted">
          ℹ️ « Calibration HDR Windows » ouvre l'outil officiel (il s'installe depuis le Store la 1ʳᵉ fois).
        </p>
      </motion.section>
    </div>
  )
}
