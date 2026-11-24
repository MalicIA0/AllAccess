import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { SyncProgress } from '../../../shared/types'
import designerLogo from '../assets/designer-web-logo.png'

export type PageId =
  | 'library'
  | 'downloads'
  | 'apps'
  | 'amis'
  | 'messages'
  | 'gamepass'
  | 'dashboard'
  | 'settings'
  | 'overlay'
  | 'hdr'

/* ---------- icônes SVG (trait fin, héritent de la couleur du texte) ---------- */
type IconProps = { className?: string }
const Icon = ({ children, className }: { children: React.ReactNode } & IconProps): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className ?? 'h-[18px] w-[18px]'}
  >
    {children}
  </svg>
)

// Pages de navigation principale = tout sauf les pages Widget (overlay, hdr) qui vivent dans WIDGETS.
type NavPageId = Exclude<PageId, 'overlay' | 'hdr'>

// icônes de la navigation principale (les pages Widget portent la leur dans WIDGETS)
const ICONS: Record<NavPageId, React.JSX.Element> = {
  library: (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  ),
  downloads: (
    <Icon>
      <path d="M12 3v10" />
      <path d="M8 9.5l4 4 4-4" />
      <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
    </Icon>
  ),
  amis: (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5" />
      <path d="M17.5 14.3A5.5 5.5 0 0 1 20.5 19" />
    </Icon>
  ),
  messages: (
    <Icon>
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
      <path d="M8 9h8M8 12.5h5" />
    </Icon>
  ),
  gamepass: (
    <Icon>
      <path d="M6 12h4M8 10v4" />
      <circle cx="15.5" cy="10.5" r="1" />
      <circle cx="17.5" cy="13.5" r="1" />
      <rect x="2.5" y="6" width="19" height="12" rx="6" />
    </Icon>
  ),
  apps: (
    <Icon>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5" />
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M8 12h8" />
    </Icon>
  ),
  dashboard: (
    <Icon>
      <path d="M4 20V10M9 20V4M14 20v-7M19 20V8" />
    </Icon>
  ),
  settings: (
    <Icon>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H8a1.65 1.65 0 0 0 1-1.51V2a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V8a1.65 1.65 0 0 0 1.51 1H22a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  )
}

const NAV: { id: NavPageId; label: string }[] = [
  { id: 'library', label: 'Bibliothèque' },
  { id: 'downloads', label: 'Téléchargements' },
  { id: 'apps', label: 'Applications' },
  { id: 'amis', label: 'Amis' },
  { id: 'messages', label: 'Messages' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'gamepass', label: 'Catalogue' },
  { id: 'settings', label: 'Réglages' }
]

// Regroupe la nav principale par catégorie (séparateurs visuels, sans libellé — contrairement
// à la section Widget plus bas qui, elle, a son propre en-tête).
const NAV_GROUPS: NavPageId[][] = [
  ['library', 'downloads', 'apps', 'amis', 'messages'],
  ['dashboard', 'gamepass'],
  ['settings']
]

/* Widgets = pages dédiées aux overlays/outils externes (installation + lancement).
   Pour en ajouter un plus tard, il suffit d'ajouter une entrée ici + sa page. */
const WIDGETS: { id: PageId; label: string; icon: React.JSX.Element }[] = [
  {
    id: 'overlay',
    label: 'Overlay',
    icon: (
      <Icon>
        <path d="M3 17a9 9 0 0 1 18 0" />
        <path d="M12 17l4.5-5" />
        <circle cx="12" cy="17" r="1.2" />
      </Icon>
    )
  },
  {
    id: 'hdr',
    label: 'HDR',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
      </Icon>
    )
  }
]

export default function Sidebar({
  page,
  onNavigate,
  sync,
  friendsCount,
  downloadCount
}: {
  page: PageId
  onNavigate: (p: PageId) => void
  sync: SyncProgress | null
  friendsCount: { online: number; total: number } | null
  /** Nombre de téléchargements en cours — pastille animée à côté de « Téléchargements » */
  downloadCount: number
}): React.JSX.Element {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.api.getAppVersion().then(setVersion)
  }, [])

  return (
    <aside className="relative z-10 flex w-64 shrink-0 flex-col border-r border-vault-border/50 bg-vault-panel/85 p-4 backdrop-blur-2xl">
      {/* Marque / identité */}
      <div className="mb-6 flex items-center gap-3 px-2 pt-1">
        <div className="relative">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-vault-accent to-vault-accent2 text-lg font-black text-white shadow-lg shadow-vault-accent/30">
            AA
          </div>
          <div className="absolute -inset-1 -z-10 rounded-2xl bg-gradient-to-br from-vault-accent to-vault-accent2 opacity-40 blur-md" />
        </div>
        <div className="leading-tight">
          <p className="text-[15px] font-black tracking-tight">
            All <span className="bg-gradient-to-r from-vault-accent to-vault-accent2 bg-clip-text text-transparent">Access</span>
          </p>
          <p className="text-[10px] font-medium text-vault-muted">Ton hub de jeux · premium</p>
        </div>
      </div>

      {/* Navigation — groupée par catégorie (Bibliothèque/Applications/Amis, Dashboard/Catalogue, Réglages),
          chaque groupe séparé par un léger espacement + un filet, sans libellé de catégorie. */}
      <nav className="flex flex-col gap-4">
        {NAV_GROUPS.map((group, gi) => (
          <div
            key={gi}
            className={`flex flex-col gap-1 ${gi > 0 ? 'border-t border-vault-border/50 pt-4' : ''}`}
          >
            {group.map((id) => {
              const item = NAV.find((n) => n.id === id)!
              const active = page === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                    active ? 'text-vault-text' : 'text-vault-muted hover:bg-white/5 hover:text-vault-text'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-xl border border-vault-accent/30 bg-gradient-to-r from-vault-accent/20 to-vault-accent2/[0.08] shadow-[0_0_20px_-4px_var(--color-vault-accent)]"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  {active && (
                    <motion.span
                      layoutId="nav-bar"
                      className="absolute top-1/2 left-0 h-6 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-vault-accent to-vault-accent2"
                      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    />
                  )}
                  <span className={`relative transition ${active ? 'text-vault-accent2' : 'group-hover:text-vault-text'}`}>
                    {ICONS[item.id]}
                  </span>
                  <span className="relative">{item.label}</span>
                  {item.id === 'downloads' && downloadCount > 0 && (
                    <span
                      title={`${downloadCount} téléchargement(s) en cours`}
                      className="relative ml-auto flex items-center gap-1.5 rounded-full bg-vault-accent/20 px-2 py-0.5 text-[11px] font-black tabular-nums text-vault-accent2"
                    >
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-vault-accent2 shadow-[0_0_8px_currentColor]" />
                      {downloadCount}
                    </span>
                  )}
                  {item.id === 'amis' && friendsCount && (
                    <span
                      title={`${friendsCount.online} ami(s) en ligne sur ${friendsCount.total}`}
                      className="relative ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold tabular-nums text-vault-muted"
                    >
                      {friendsCount.online}/{friendsCount.total}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Section Widgets — pages dédiées aux overlays (installation + lancement), extensible.
          Séparée de la navigation par un espace, avec son propre libellé de catégorie. */}
      <div className="mt-8">
        <p className="mb-2 px-3.5 text-[10px] font-bold uppercase tracking-wider text-vault-muted/60">Widget</p>
        <div className="flex flex-col gap-1">
          {WIDGETS.map((w) => {
            const active = page === w.id
            return (
              <button
                key={w.id}
                onClick={() => onNavigate(w.id)}
                className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                  active ? 'text-vault-text' : 'text-vault-muted hover:bg-white/5 hover:text-vault-text'
                }`}
              >
                {active && (
                  <span className="absolute inset-0 rounded-xl border border-vault-accent/30 bg-gradient-to-r from-vault-accent/20 to-vault-accent2/[0.08] shadow-[0_0_20px_-4px_var(--color-vault-accent)]" />
                )}
                <span className={`relative transition ${active ? 'text-vault-accent2' : 'group-hover:text-vault-accent2'}`}>
                  {w.icon}
                </span>
                <span className="relative">{w.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Pied : sync + version */}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        {sync && (
          <div className="glass rounded-xl p-3">
            <div className="mb-1 flex items-center gap-2">
              {!sync.done && (
                <span className="h-2 w-2 animate-pulse rounded-full bg-vault-accent2 shadow-[0_0_8px_currentColor]" />
              )}
              <p className="text-xs font-semibold text-vault-accent2">{sync.phase}</p>
            </div>
            <p className="truncate text-xs text-vault-muted">{sync.error ?? sync.detail}</p>
          </div>
        )}
        {/* Crédit — « Design par » + logo JD Designer, cliquable → ouvre le site du designer */}
        <button
          type="button"
          onClick={() => void window.api.openExternal('https://jd-webdesign-nine.vercel.app/')}
          title="Voir le site de JD Designer"
          className="group flex flex-col items-center gap-1 px-2 pt-1 transition hover:opacity-100 focus:outline-none"
        >
          <span className="text-[9px] font-medium tracking-wide text-vault-muted/70 transition group-hover:text-vault-accent2">
            Design par
          </span>
          <img
            src={designerLogo}
            alt="JD Designer"
            className="h-auto w-[185px] max-w-full cursor-pointer object-contain transition group-hover:scale-[1.03] group-hover:drop-shadow-[0_0_10px_var(--color-vault-accent)]"
          />
        </button>

        <p className="text-center text-[10px] font-medium text-vault-muted/70">All Access {version && `v${version}`}</p>
      </div>
    </aside>
  )
}
