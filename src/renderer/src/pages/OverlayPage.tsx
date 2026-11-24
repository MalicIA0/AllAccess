import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * Page « Overlay » — propose d'installer le mini-moniteur HW Monitor (CPU/GPU/RAM/FPS)
 * sur ce PC à partir des fichiers embarqués dans All Access, puis de le lancer.
 * L'installation copie l'overlay dans %LOCALAPPDATA%\Programs\HW Monitor et crée un
 * raccourci sur le bureau : il devient utilisable même sans ouvrir All Access.
 */
export default function OverlayPage(): React.JSX.Element {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [installDir, setInstallDir] = useState('')
  const [busy, setBusy] = useState<'install' | 'launch' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = (): void => {
    void window.api.getPerfStatus().then((s) => {
      setInstalled(s.installed)
      setInstallDir(s.installDir)
    })
  }
  useEffect(refresh, [])

  const install = async (): Promise<void> => {
    setBusy('install')
    setMessage(null)
    const r = await window.api.installPerf()
    setBusy(null)
    setMessage(
      r.ok
        ? { ok: true, text: 'Overlay installé — un raccourci « HW Monitor » a été ajouté sur ton bureau.' }
        : { ok: false, text: r.error ?? "Échec de l'installation." }
    )
    // signale à la sonnette de mise à jour (Titlebar) de re-vérifier tout de suite
    if (r.ok) window.dispatchEvent(new Event('perf-installed'))
    refresh()
  }

  const launch = async (): Promise<void> => {
    setBusy('launch')
    setMessage(null)
    const r = await window.api.launchPerf()
    setBusy(null)
    if (!r.ok) setMessage({ ok: false, text: r.error ?? 'Échec du lancement.' })
  }

  const feature = (icon: string, title: string, desc: string): React.JSX.Element => (
    <div className="glass flex items-start gap-3 rounded-xl p-4">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-vault-muted">{desc}</p>
      </div>
    </div>
  )

  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-3xl font-black tracking-tight">Overlay Performances</h1>
      <p className="mb-8 text-sm text-vault-muted">
        Un mini-moniteur discret en haut à gauche de l'écran pendant que tu joues : températures CPU/GPU, RAM,
        résolution de rendu et FPS en temps réel, avec un bouton pour le rétracter.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3">
        {feature('🌡️', 'Températures CPU & GPU', 'Code couleur vert / orange / rouge selon la chauffe.')}
        {feature('🧠', 'Mémoire vive', "Pourcentage d'utilisation de la RAM en continu.")}
        {feature('🖥️', 'Résolution de rendu', 'Or en 4K, violet en 1440p, vert en 1080p — orange en dessous.')}
        {feature('🎯', 'FPS en jeu', 'Compteur d’images par seconde du jeu au premier plan (PresentMon).')}
        {feature('☀️', 'HDR', 'État ON / OFF en direct, basculable d’un clic depuis l’overlay.')}
        {feature('🫥', 'Discret', 'Rétractable d’un clic, lisible sur fond clair comme sombre.')}
      </div>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl border border-vault-accent/30 p-6"
      >
        {installed === null ? (
          <div className="skeleton h-12 rounded-xl" />
        ) : installed ? (
          <>
            <p className="mb-1 flex items-center gap-2 text-sm font-bold text-vault-green">
              <span className="h-2 w-2 rounded-full bg-vault-green shadow-[0_0_8px_currentColor]" /> Installé sur ce PC
            </p>
            <p className="mb-4 text-xs text-vault-muted">{installDir}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => void launch()}
                disabled={busy !== null}
                className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {busy === 'launch' ? 'Lancement…' : "▶ Lancer l'overlay"}
              </button>
              <button
                onClick={() => void install()}
                disabled={busy !== null}
                className="rounded-xl border border-vault-border px-5 py-3 text-sm font-semibold text-vault-muted transition hover:border-vault-accent/50 hover:text-vault-text disabled:opacity-50"
              >
                {busy === 'install' ? 'Réinstallation…' : '⟳ Réinstaller / mettre à jour'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-1 text-sm font-bold">Pas encore installé sur ce PC</p>
            <p className="mb-4 text-xs text-vault-muted">
              L'installation copie l'overlay dans <span className="font-semibold">{installDir}</span> et ajoute un
              raccourci « HW Monitor » sur ton bureau — il restera utilisable même sans ouvrir All Access.
            </p>
            <button
              onClick={() => void install()}
              disabled={busy !== null}
              className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy === 'install' ? 'Installation…' : "⬇ Installer l'overlay"}
            </button>
          </>
        )}

        {message && (
          <p className={`mt-4 text-sm font-semibold ${message.ok ? 'text-vault-green' : 'text-red-400'}`}>
            {message.ok ? '✓ ' : '⚠ '}
            {message.text}
          </p>
        )}

        <p className="mt-5 text-[11px] leading-relaxed text-vault-muted">
          ℹ️ Au lancement, Windows affiche une demande d'autorisation (UAC) : les capteurs matériels exigent les droits
          administrateur — c'est normal. En jeu, préfère le mode <b>fenêtré sans bordure</b> : en plein écran exclusif,
          Windows n'affiche aucun overlay par-dessus le jeu.
        </p>
      </motion.section>
    </div>
  )
}
