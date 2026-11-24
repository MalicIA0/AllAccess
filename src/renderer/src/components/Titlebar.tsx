import UpdateBadges from './UpdateBadges'
import NotificationBell from './NotificationBell'

export default function Titlebar(): React.JSX.Element {
  return (
    <header className="titlebar-drag flex h-10 shrink-0 items-center justify-between border-b border-vault-border/60 bg-vault-panel/40 pl-4">
      <div className="flex items-center gap-2">
        <span className="text-glow bg-gradient-to-r from-vault-accent to-vault-accent2 bg-clip-text text-sm font-black tracking-widest text-transparent">
          ALL ACCESS
        </span>
      </div>
      <div className="titlebar-nodrag flex h-full">
        <NotificationBell />
        <UpdateBadges />
        <button
          onClick={() => window.api.minimize()}
          className="flex h-full w-12 items-center justify-center text-vault-muted transition hover:bg-white/5 hover:text-vault-text"
          title="Réduire"
        >
          ─
        </button>
        <button
          onClick={() => window.api.maximize()}
          className="flex h-full w-12 items-center justify-center text-vault-muted transition hover:bg-white/5 hover:text-vault-text"
          title="Agrandir"
        >
          ☐
        </button>
        <button
          onClick={() => window.api.close()}
          className="flex h-full w-12 items-center justify-center text-vault-muted transition hover:bg-red-500/80 hover:text-white"
          title="Masquer (l'app reste dans la barre système)"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
