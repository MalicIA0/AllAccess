import { useEffect, useRef, useState } from 'react'
import type { AppSettings, AuthStatus, BgMode, CardSize, ChimeStyle, NotifStyle } from '../../../shared/types'
import { playChime } from '../lib/chimes'

/** Aperçu animé miniature d'un style de fond (CSS pur, léger). */
const BG_STYLES: { id: BgMode; label: string; desc: string; preview: string }[] = [
  { id: 'off', label: 'Désactivé', desc: 'Fond uni, zéro animation', preview: 'bg-vault-bg' },
  { id: 'halos', label: 'Halos', desc: 'Nuages de couleur dérivants', preview: 'bg-[radial-gradient(circle_at_25%_25%,var(--color-vault-accent),transparent_55%),radial-gradient(circle_at_80%_80%,var(--color-vault-accent2),transparent_55%)]' },
  { id: 'halos-particules', label: 'Particules', desc: 'Poussière lumineuse + halos', preview: 'bg-[radial-gradient(circle_at_30%_40%,var(--color-vault-accent),transparent_50%),radial-gradient(circle_at_70%_60%,var(--color-vault-accent2),transparent_50%)]' },
  { id: 'constellation', label: 'Constellation', desc: 'Réseau de points reliés', preview: 'bg-[linear-gradient(135deg,var(--color-vault-accent),var(--color-vault-accent2))]' },
  { id: 'aurore', label: 'Aurore', desc: 'Rubans ondulants', preview: 'bg-[linear-gradient(180deg,transparent,var(--color-vault-accent)_50%,transparent)]' },
  { id: 'grille', label: 'Grille rétro', desc: 'Perspective synthwave', preview: 'bg-[linear-gradient(0deg,var(--color-vault-accent2),transparent_70%)]' },
  { id: 'orbes', label: 'Orbes', desc: 'Grandes bulles douces', preview: 'bg-[radial-gradient(circle_at_35%_65%,var(--color-vault-accent),transparent_45%),radial-gradient(circle_at_70%_30%,var(--color-vault-accent2),transparent_45%)]' },
  { id: 'meteores', label: 'Météores', desc: 'Ciel étoilé + étoiles filantes', preview: 'bg-[radial-gradient(circle_at_80%_20%,white_1px,transparent_2px),radial-gradient(circle_at_30%_50%,white_1px,transparent_2px),radial-gradient(circle_at_60%_75%,white_1px,transparent_2px),linear-gradient(145deg,transparent_40%,var(--color-vault-accent2)_50%,transparent_60%),linear-gradient(180deg,#04060e,#0a0d1a)]' },
  { id: 'lucioles', label: 'Lucioles', desc: 'Lueurs errantes qui pulsent', preview: 'bg-[radial-gradient(circle_at_25%_35%,var(--color-vault-accent)_2%,transparent_18%),radial-gradient(circle_at_70%_60%,var(--color-vault-accent2)_2%,transparent_16%),radial-gradient(circle_at_50%_20%,var(--color-vault-accent)_1%,transparent_12%)]' },
  { id: 'vortex', label: 'Vortex', desc: 'Spirale galactique en orbite', preview: 'bg-[conic-gradient(from_45deg_at_50%_50%,transparent,var(--color-vault-accent),transparent_35%,var(--color-vault-accent2),transparent_70%)]' },
  { id: 'flux', label: 'Flux', desc: "Rubans d'énergie fluides", preview: 'bg-[linear-gradient(100deg,transparent_20%,var(--color-vault-accent)_35%,transparent_45%,var(--color-vault-accent2)_65%,transparent_80%)]' },
  { id: 'nebuleuse', label: 'Nébuleuse ⚡', desc: 'Nuages fractals + étoiles (GPU)', preview: 'bg-[radial-gradient(ellipse_at_30%_40%,var(--color-vault-accent)_0%,transparent_55%),radial-gradient(ellipse_at_75%_65%,var(--color-vault-accent2)_0%,transparent_50%),radial-gradient(circle_at_60%_25%,white_1px,transparent_2px)]' },
  { id: 'plasma', label: 'Plasma ⚡', desc: 'Ondes psychédéliques (GPU)', preview: 'bg-[repeating-linear-gradient(60deg,var(--color-vault-accent),var(--color-vault-accent2)_18px,var(--color-vault-accent)_36px)]' },
  { id: 'liquide', label: 'Liquide ⚡', desc: 'Encre marbrée en mouvement (GPU)', preview: 'bg-[radial-gradient(ellipse_at_20%_80%,var(--color-vault-accent)_0%,transparent_45%),radial-gradient(ellipse_at_80%_20%,var(--color-vault-accent2)_0%,transparent_45%),radial-gradient(ellipse_at_55%_55%,var(--color-vault-accent)_0%,transparent_35%)]' }
]

const NOTIF_STYLES: { id: NotifStyle; label: string; desc: string }[] = [
  { id: 'banniere', label: 'Bannière', desc: 'Large, en bas au centre' },
  { id: 'toast', label: 'Toast', desc: 'Compact, coin haut-droit' },
  { id: 'cinema', label: 'Cinéma', desc: 'Grande carte centrée' },
  { id: 'plein', label: 'Plein écran', desc: 'Cinématique, couvre l’écran' },
  { id: 'sticker', label: 'Sticker', desc: 'Glisse de la droite et se colle' },
  { id: 'feuartifice', label: 'Feu d’artifice', desc: 'Gerbes d’étincelles discrètes' },
  { id: 'neon', label: 'Néon', desc: 'L’enseigne qui grésille et s’allume' }
]

const CHIME_STYLES: { id: ChimeStyle; label: string; desc: string }[] = [
  { id: 'cristal', label: 'Cristal', desc: 'Carillon clair et chaud' },
  { id: 'arcade', label: 'Arcade', desc: 'Bips 8-bit rétro' },
  { id: 'cinematique', label: 'Cinématique', desc: 'Impact grave et nappe' },
  { id: 'cloche', label: 'Cloche', desc: "Carillon d'église résonant" },
  { id: 'harpe', label: 'Harpe', desc: 'Arpège cristallin ascendant' },
  { id: 'fanfare', label: 'Fanfare', desc: 'Cuivres triomphants' },
  { id: 'zen', label: 'Zen', desc: 'Bol tibétain apaisant' },
  { id: 'laser', label: 'Laser', desc: 'Zap sci-fi futuriste' },
  { id: 'magie', label: 'Magie', desc: "Pluie d'étincelles" },
  { id: 'piece', label: 'Pièce', desc: 'Pièce ramassée façon rétro' },
  { id: 'digital', label: 'Digital', desc: 'Notification moderne épurée' },
  { id: 'gong', label: 'Gong', desc: 'Gong métallique grave et long' },
  { id: 'choeur', label: 'Chœur', desc: 'Voix majestueuses façon nappe' }
]

const DEFAULTS: AppSettings = {
  autostart: true,
  autoSyncOnLaunch: true,
  pollAchievementsSec: 60,
  pollFriendsMin: 15,
  theme: 'nebula',
  notifSound: true,
  chimeVolume: 60,
  chimeStyle: 'cristal',
  notifStyle: 'banniere',
  notifDurationSec: 10,
  bgMode: 'halos-particules',
  bgSpeed: 1,
  cardSize: 'normal'
}

// NB : les 6 premiers gardent leur id historique (thème sauvegardé intact) mais ont été
// entièrement redessinés — palettes néon/luxe, saturation poussée.
const THEMES: { id: string; name: string; from: string; to: string; bg: string }[] = [
  { id: 'nebula', name: 'Ultraviolet', from: '#9d4dff', to: '#ff3df5', bg: '#09041a' },
  { id: 'rubis', name: 'Carmin', from: '#ff1745', to: '#ffd166', bg: '#130308' },
  { id: 'emeraude', name: 'Hologramme', from: '#00ffc8', to: '#ff8ae2', bg: '#020d0c' },
  { id: 'minuit', name: 'Saphir', from: '#2979ff', to: '#00e5ff', bg: '#02081c' },
  { id: 'crepuscule', name: 'Éclipse', from: '#ff6a00', to: '#ff2fa0', bg: '#150408' },
  { id: 'ornoir', name: 'Midas', from: '#ffd60a', to: '#fff3b0', bg: '#0a0904' },
  { id: 'mono', name: 'Monochrome', from: '#737373', to: '#d4d4d4', bg: '#0a0a0a' },
  { id: 'synthwave', name: 'Synthwave', from: '#f472b6', to: '#38bdf8', bg: '#0d0718' },
  { id: 'sakura', name: 'Sakura', from: '#fb7185', to: '#fbcfe8', bg: '#130a10' },
  { id: 'glacier', name: 'Glacier', from: '#38bdf8', to: '#e0f2fe', bg: '#06111a' },
  { id: 'foret', name: 'Forêt', from: '#4ade80', to: '#fbbf24', bg: '#0a120b' },
  { id: 'royal', name: 'Royal', from: '#6366f1', to: '#f59e0b', bg: '#0b0a16' },
  { id: 'neon', name: 'Néon', from: '#00ff88', to: '#ff2ec4', bg: '#050807' },
  { id: 'volcan', name: 'Volcan', from: '#ff4d00', to: '#fbbf24', bg: '#140705' },
  { id: 'cyber', name: 'Cyber', from: '#fde047', to: '#22d3ee', bg: '#0d0c04' },
  { id: 'abysse', name: 'Abysse', from: '#06b6d4', to: '#818cf8', bg: '#030c16' },
  { id: 'toxique', name: 'Toxique', from: '#a3e635', to: '#c084fc', bg: '#0a1004' },
  { id: 'vapeur', name: 'Vapeur', from: '#c084fc', to: '#5eead4', bg: '#0e0916' }
]

function ChipGroup<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="flex gap-1 rounded-xl border border-vault-border p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
            value === o.id ? 'bg-vault-accent/25 text-vault-text' : 'text-vault-muted hover:text-vault-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Nombre d'éléments visibles par ligne quand une grille est repliée. */
const THEME_COLLAPSED_COUNT = 6
const BG_COLLAPSED_COUNT = 4
const NOTIF_COLLAPSED_COUNT = 3
const CHIME_COLLAPSED_COUNT = 3

/**
 * Sous-ensemble affiché d'une grille repliable : les N premiers éléments, en garantissant que
 * l'option actuellement sélectionnée reste visible même repliée (jamais cachée sans le savoir).
 */
function visibleSlice<T>(all: T[], count: number, expanded: boolean, isSelected: (item: T) => boolean): T[] {
  if (expanded || all.length <= count) return all
  const selectedIdx = all.findIndex(isSelected)
  if (selectedIdx === -1 || selectedIdx < count) return all.slice(0, count)
  return [...all.slice(0, count - 1), all[selectedIdx]]
}

/** Bouton « voir plus / réduire » sous une grille repliée à une seule ligne. */
function ExpandToggle({
  expanded,
  remaining,
  onClick
}: {
  expanded: boolean
  remaining: number
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-vault-accent2 transition hover:text-vault-text"
    >
      {expanded ? '▲ Réduire' : `▾ Voir les ${remaining} autres`}
    </button>
  )
}

function AccountCard({
  badge,
  badgeClass,
  title,
  connectedLabel,
  connected,
  busy,
  error,
  onConnect,
  onDisconnect
}: {
  badge: string
  badgeClass: string
  title: string
  connectedLabel: string | null
  connected: boolean
  busy: boolean
  error: string | null
  onConnect: () => void
  onDisconnect: () => void
}): React.JSX.Element {
  return (
    <section className="glass mb-6 rounded-2xl p-6">
      <div className="flex items-center gap-4">
        <span className={`rounded-md px-2 py-0.5 text-xs font-black ${badgeClass}`}>{badge}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{title}</h2>
          {connected ? (
            <p className="flex items-center gap-2 text-sm text-vault-green">
              <span className="h-2 w-2 rounded-full bg-vault-green" />
              Connecté{connectedLabel ? ` — ${connectedLabel}` : ''}
            </p>
          ) : (
            <p className="text-sm text-vault-muted">Non connecté</p>
          )}
        </div>
        {connected ? (
          <button
            onClick={onDisconnect}
            className="rounded-xl border border-vault-border px-4 py-2 text-sm font-semibold text-vault-muted transition hover:border-red-400/50 hover:text-red-400"
          >
            Déconnecter
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  )
}

export default function Settings({
  onSaved,
  onSettingsChanged
}: {
  onSaved: () => void
  onSettingsChanged: (s: AppSettings) => void
}): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)
  // Miroir synchrone de `settings` : évite qu'un enregistrement basé sur une closure
  // périmée réécrive un réglage tout juste changé (ex. le thème écrasé par un autre patch).
  const settingsRef = useRef<AppSettings>(DEFAULTS)
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [busy, setBusy] = useState<'steam' | 'xbox' | 'epic' | null>(null)
  const [errors, setErrors] = useState<{ steam: string | null; xbox: string | null; epic: string | null }>({
    steam: null,
    xbox: null,
    epic: null
  })
  const [saved, setSaved] = useState(false)
  const [themeExpanded, setThemeExpanded] = useState(false)
  const [bgExpanded, setBgExpanded] = useState(false)
  const [notifExpanded, setNotifExpanded] = useState(false)
  const [chimeExpanded, setChimeExpanded] = useState(false)

  const refreshAuth = async (): Promise<void> => setAuth(await window.api.getAuthStatus())

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      settingsRef.current = s
      setSettings(s)
    })
    void refreshAuth()
  }, [])

  const connectSteam = async (): Promise<void> => {
    setBusy('steam')
    setErrors((e) => ({ ...e, steam: null }))
    const r = await window.api.steamLogin()
    setBusy(null)
    if (!r.ok) setErrors((e) => ({ ...e, steam: r.error ?? 'Échec de la connexion' }))
    await refreshAuth()
    if (r.ok) onSaved() // lance la sync directement
  }

  const connectXbox = async (): Promise<void> => {
    setBusy('xbox')
    setErrors((e) => ({ ...e, xbox: null }))
    const r = await window.api.xboxLogin()
    setBusy(null)
    if (!r.ok) setErrors((e) => ({ ...e, xbox: r.error ?? 'Échec de la connexion' }))
    await refreshAuth()
    if (r.ok) onSaved()
  }

  const connectEpic = async (): Promise<void> => {
    setBusy('epic')
    setErrors((e) => ({ ...e, epic: null }))
    const r = await window.api.epicLogin()
    setBusy(null)
    if (!r.ok) setErrors((e) => ({ ...e, epic: r.error ?? 'Échec de la connexion' }))
    await refreshAuth()
    if (r.ok) onSaved()
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]): void => {
    setSaved(false)
    const next = { ...settingsRef.current, [k]: v }
    settingsRef.current = next
    setSettings(next)
  }

  const save = async (): Promise<void> => {
    const next = settingsRef.current
    await window.api.saveSettings(next)
    onSettingsChanged(next)
    setSaved(true)
  }

  /** Réglages visuels : application immédiate + sauvegarde automatique.
   *  On part TOUJOURS de settingsRef (état le plus frais, synchrone) pour ne jamais
   *  réécrire par-dessus un réglage changé une fraction de seconde plus tôt. */
  const applyNow = async (patch: Partial<AppSettings>): Promise<void> => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    onSettingsChanged(next)
    await window.api.saveSettings(next)
  }

  const selectTheme = (id: string): Promise<void> => applyNow({ theme: id })

  return (
    <div className="max-w-2xl pb-8">
      <h1 className="mb-2 text-3xl font-black tracking-tight">Réglages</h1>
      <p className="mb-8 text-sm text-vault-muted">
        Connecte tes comptes : tu te connectes sur les <b>vraies pages</b> Steam, Microsoft et Epic — All Access ne
        voit jamais ton mot de passe et ne garde que des jetons de session, chiffrés sur ce PC.
      </p>

      <AccountCard
        badge="STEAM"
        badgeClass="bg-[#1b2838] text-[#66c0f4]"
        title="Compte Steam"
        connected={auth?.steam.connected ?? false}
        connectedLabel={auth?.steam.steamId64 ? `SteamID ${auth.steam.steamId64}` : null}
        busy={busy === 'steam'}
        error={errors.steam}
        onConnect={() => void connectSteam()}
        onDisconnect={() => void window.api.steamLogout().then(refreshAuth)}
      />

      <AccountCard
        badge="XBOX"
        badgeClass="bg-[#107c10] text-white"
        title="Compte Xbox / Game Pass"
        connected={auth?.xbox.connected ?? false}
        connectedLabel={auth?.xbox.gamertag ?? null}
        busy={busy === 'xbox'}
        error={errors.xbox}
        onConnect={() => void connectXbox()}
        onDisconnect={() => void window.api.xboxLogout().then(refreshAuth)}
      />

      <AccountCard
        badge="EPIC"
        badgeClass="bg-black text-white"
        title="Compte Epic Games"
        connected={auth?.epic.connected ?? false}
        connectedLabel={auth?.epic.displayName || null}
        busy={busy === 'epic'}
        error={errors.epic}
        onConnect={() => void connectEpic()}
        onDisconnect={() => void window.api.epicLogout().then(refreshAuth)}
      />

      {/* Synchronisation manuelle — déplacée ici depuis la barre latérale */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <button
          onClick={() => onSaved()}
          className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-10 py-3.5 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98]"
        >
          ⟳ Synchroniser maintenant
        </button>
        <p className="text-xs text-vault-muted">Réimporte ta bibliothèque, tes succès et tes jeux installés.</p>
      </div>

      <div className="glass mb-6 rounded-2xl p-5 text-xs leading-relaxed text-vault-muted">
        <p className="mb-1 font-bold text-vault-text">🎮 Ubisoft Connect &amp; Rockstar</p>
        Ces launchers n'offrent pas de connexion sécurisée par jetons — All Access détecte donc automatiquement leurs
        jeux <b>installés sur ce PC</b> (aucun mot de passe demandé). Installe un jeu Ubisoft ou Rockstar, puis
        clique sur <b>Synchroniser</b> pour le voir apparaître.
      </div>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-1 text-lg font-bold">🎨 Thème</h2>
        <p className="mb-4 text-xs text-vault-muted">
          {THEMES.length} — changement immédiat, mémorisé automatiquement.
        </p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {visibleSlice(THEMES, THEME_COLLAPSED_COUNT, themeExpanded, (t) => t.id === settings.theme).map((t) => (
            <button
              key={t.id}
              onClick={() => void selectTheme(t.id)}
              title={t.name}
              className={`group flex flex-col items-center gap-2 rounded-xl p-2 transition ${
                settings.theme === t.id ? 'bg-white/5 ring-1 ring-vault-accent/60' : 'hover:bg-white/5'
              }`}
            >
              <span
                className="h-10 w-10 rounded-full border border-white/15 shadow-lg transition group-hover:scale-110"
                style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to} 60%, ${t.bg})` }}
              />
              <span
                className={`text-[10px] font-semibold ${
                  settings.theme === t.id ? 'text-vault-text' : 'text-vault-muted'
                }`}
              >
                {t.name}
              </span>
            </button>
          ))}
        </div>
        {THEMES.length > THEME_COLLAPSED_COUNT && (
          <ExpandToggle
            expanded={themeExpanded}
            remaining={THEMES.length - THEME_COLLAPSED_COUNT}
            onClick={() => setThemeExpanded((v) => !v)}
          />
        )}
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-1 text-lg font-bold">✨ Fond animé</h2>
        <p className="mb-4 text-xs text-vault-muted">
          {BG_STYLES.length} ambiances aux couleurs de ton thème — celles marquées ⚡ sont calculées par ta carte
          graphique (shaders GPU). Aperçu et application immédiats.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {visibleSlice(BG_STYLES, BG_COLLAPSED_COUNT, bgExpanded, (s) => s.id === settings.bgMode).map((s) => (
            <button
              key={s.id}
              onClick={() => void applyNow({ bgMode: s.id })}
              className={`group overflow-hidden rounded-xl border text-left transition ${
                settings.bgMode === s.id
                  ? 'border-vault-accent/60 ring-1 ring-vault-accent/50'
                  : 'border-vault-border hover:border-vault-accent/40'
              }`}
            >
              <span className={`block h-14 w-full ${s.preview}`} />
              <span className="block px-2.5 py-2">
                <span
                  className={`block text-xs font-bold ${settings.bgMode === s.id ? 'text-vault-text' : 'text-vault-muted'}`}
                >
                  {s.label}
                </span>
                <span className="block text-[10px] text-vault-muted">{s.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {BG_STYLES.length > BG_COLLAPSED_COUNT && (
          <ExpandToggle
            expanded={bgExpanded}
            remaining={BG_STYLES.length - BG_COLLAPSED_COUNT}
            onClick={() => setBgExpanded((v) => !v)}
          />
        )}
        {settings.bgMode !== 'off' && (
          <>
            <label className="mt-4 flex items-center justify-between gap-6">
              <span className="text-sm">
                <span className="font-semibold">Vitesse</span>
                <span className="block text-xs text-vault-muted">
                  {settings.bgSpeed <= 0.5 ? 'Très lente' : settings.bgSpeed >= 2 ? 'Très rapide' : `${settings.bgSpeed.toFixed(2)}×`}
                </span>
              </span>
              <input
                type="range"
                min={0.25}
                max={2.5}
                step={0.25}
                value={settings.bgSpeed}
                onChange={(e) => void applyNow({ bgSpeed: Number(e.target.value) })}
                className="w-48 accent-[#8b5cf6]"
              />
            </label>
          </>
        )}
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-bold">🖼️ Interface</h2>
        <div className="flex items-center justify-between">
          <span className="text-sm">
            <span className="font-semibold">Taille des jaquettes</span>
            <span className="block text-xs text-vault-muted">Bibliothèque et catalogue Game Pass</span>
          </span>
          <ChipGroup<CardSize>
            value={settings.cardSize}
            options={[
              { id: 'compact', label: 'Compacte' },
              { id: 'normal', label: 'Moyenne' },
              { id: 'large', label: 'Grande' }
            ]}
            onChange={(v) => void applyNow({ cardSize: v })}
          />
        </div>
      </section>

      <section className="glass mb-6 rounded-2xl p-6">
        <h2 className="mb-1 text-lg font-bold">🏆 Récompense de succès</h2>
        <p className="mb-4 text-xs text-vault-muted">
          Personnalise l'apparition d'un succès : style de bannière, son et volume. Application immédiate.
        </p>

        {/* Style de notification */}
        <p className="mb-2 text-sm font-semibold">
          Style de notification <span className="font-normal text-vault-muted">· {NOTIF_STYLES.length}</span>
        </p>
        <div className="grid grid-cols-3 gap-3">
          {visibleSlice(NOTIF_STYLES, NOTIF_COLLAPSED_COUNT, notifExpanded, (n) => n.id === settings.notifStyle).map(
            (n) => (
              <button
                key={n.id}
                onClick={() => void applyNow({ notifStyle: n.id })}
                className={`rounded-xl border p-3 text-left transition ${
                  settings.notifStyle === n.id
                    ? 'border-vault-accent/60 bg-white/5 ring-1 ring-vault-accent/50'
                    : 'border-vault-border hover:border-vault-accent/40'
                }`}
              >
                <span className={`block text-sm font-bold ${settings.notifStyle === n.id ? 'text-vault-text' : 'text-vault-muted'}`}>
                  {n.label}
                </span>
                <span className="block text-[10px] text-vault-muted">{n.desc}</span>
              </button>
            )
          )}
        </div>
        {NOTIF_STYLES.length > NOTIF_COLLAPSED_COUNT && (
          <ExpandToggle
            expanded={notifExpanded}
            remaining={NOTIF_STYLES.length - NOTIF_COLLAPSED_COUNT}
            onClick={() => setNotifExpanded((v) => !v)}
          />
        )}

        {/* Durée d'affichage */}
        <label className="mt-5 flex items-center justify-between gap-6">
          <span className="text-sm">
            <span className="font-semibold">Durée d'affichage</span>
            <span className="block text-xs text-vault-muted">
              {settings.notifDurationSec} s
              {settings.notifStyle === 'plein' && ' — le style « Plein écran » reste plafonné à 6 s'}
            </span>
          </span>
          <input
            type="range"
            min={3}
            max={30}
            step={1}
            value={settings.notifDurationSec}
            onChange={(e) => void applyNow({ notifDurationSec: Number(e.target.value) })}
            className="w-56 accent-[#8b5cf6]"
          />
        </label>

        {/* Son */}
        <label className="mt-5 mb-3 flex items-center justify-between">
          <span className="text-sm">
            <span className="font-semibold">Son de déblocage</span>
            <span className="block text-xs text-vault-muted">Carillon lors d'un succès — plus riche pour les rares.</span>
          </span>
          <input
            type="checkbox"
            checked={settings.notifSound}
            onChange={(e) => void applyNow({ notifSound: e.target.checked })}
            className="h-5 w-5 accent-[#8b5cf6]"
          />
        </label>

        {settings.notifSound && (
          <>
            <p className="mb-2 text-sm font-semibold">
              Timbre du son <span className="font-normal text-vault-muted">· {CHIME_STYLES.length}</span>
            </p>
            <div className="grid grid-cols-3 gap-3">
              {visibleSlice(CHIME_STYLES, CHIME_COLLAPSED_COUNT, chimeExpanded, (c) => c.id === settings.chimeStyle).map(
                (c) => (
                  <div
                    key={c.id}
                    className={`rounded-xl border p-3 transition ${
                      settings.chimeStyle === c.id
                        ? 'border-vault-accent/60 bg-white/5 ring-1 ring-vault-accent/50'
                        : 'border-vault-border'
                    }`}
                  >
                    <button onClick={() => void applyNow({ chimeStyle: c.id })} className="block w-full text-left">
                      <span className={`block text-sm font-bold ${settings.chimeStyle === c.id ? 'text-vault-text' : 'text-vault-muted'}`}>
                        {c.label}
                      </span>
                      <span className="block text-[10px] text-vault-muted">{c.desc}</span>
                    </button>
                    <button
                      onClick={() => playChime(c.id, 5, settings.chimeVolume / 100)}
                      className="mt-2 w-full rounded-lg border border-vault-border py-1 text-[11px] font-semibold text-vault-muted transition hover:border-vault-accent/50 hover:text-vault-text"
                    >
                      ▶ Écouter
                    </button>
                  </div>
                )
              )}
            </div>
            {CHIME_STYLES.length > CHIME_COLLAPSED_COUNT && (
              <ExpandToggle
                expanded={chimeExpanded}
                remaining={CHIME_STYLES.length - CHIME_COLLAPSED_COUNT}
                onClick={() => setChimeExpanded((v) => !v)}
              />
            )}
            <label className="mt-4 flex items-center justify-between gap-6">
              <span className="text-sm">
                <span className="font-semibold">Volume</span>
                <span className="block text-xs text-vault-muted">{settings.chimeVolume}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.chimeVolume}
                onChange={(e) => void applyNow({ chimeVolume: Number(e.target.value) })}
                className="w-48 accent-[#8b5cf6]"
              />
            </label>
          </>
        )}

        <div className="mt-5">
          <button
            onClick={() => void window.api.testAchievement()}
            className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98]"
          >
            🔔 Tester la notification complète
          </button>
        </div>
      </section>

      <section className="glass mb-8 rounded-2xl p-6">
        <h2 className="mb-4 text-lg font-bold">⚙️ Comportement</h2>
        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between">
            <span className="text-sm">
              <span className="font-semibold">Connexion et synchronisation automatiques</span>
              <span className="block text-xs text-vault-muted">
                Reconnecte Steam/Xbox/Epic (jetons déjà enregistrés) au démarrage, puis resynchronise la bibliothèque
                toutes les 10 min pendant que l'appli reste ouverte (ex. un jeu qui finit de s'installer).
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.autoSyncOnLaunch}
              onChange={(e) => void applyNow({ autoSyncOnLaunch: e.target.checked })}
              className="h-5 w-5 accent-[#8b5cf6]"
            />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm">
              <span className="font-semibold">Démarrer avec Windows</span>
              <span className="block text-xs text-vault-muted">
                Nécessaire pour détecter les jeux et notifier les succès en continu (démarre caché dans le tray).
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.autostart}
              onChange={(e) => set('autostart', e.target.checked)}
              className="h-5 w-5 accent-[#8b5cf6]"
            />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm">
              <span className="font-semibold">Fréquence de vérification des succès en jeu</span>
              <span className="block text-xs text-vault-muted">Pendant qu'un jeu tourne (secondes)</span>
            </span>
            <input
              type="number"
              min={30}
              max={600}
              value={settings.pollAchievementsSec}
              onChange={(e) => set('pollAchievementsSec', Number(e.target.value) || 60)}
              className="glass w-24 rounded-xl px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm">
              <span className="font-semibold">Fréquence de vérification des amis</span>
              <span className="block text-xs text-vault-muted">Statut en ligne / hors ligne (minutes)</span>
            </span>
            <input
              type="number"
              min={5}
              max={60}
              value={settings.pollFriendsMin}
              onChange={(e) => set('pollFriendsMin', Number(e.target.value) || 15)}
              className="glass w-24 rounded-xl px-3 py-2 text-sm outline-none"
            />
          </label>
        </div>
      </section>

      <div className="glass rounded-2xl p-5 text-xs leading-relaxed text-vault-muted">
        <p className="mb-1 font-bold text-vault-text">🔒 Confidentialité</p>
        100 % local : aucune donnée n'est envoyée ailleurs que vers Steam et Xbox eux-mêmes. Déconnecter un compte
        efface son jeton et ses cookies de session.
      </div>

      {/* Barre d'application — hors des sections, alignée à droite, tout en bas de la page */}
      <div className="mt-2 flex items-center justify-end gap-4 pb-2">
        {saved && <span className="text-sm font-semibold text-vault-green">✓ Appliqué</span>}
        <button
          onClick={() => void save()}
          className="rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-10 py-3.5 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98]"
        >
          Tout appliquer
        </button>
      </div>
    </div>
  )
}
