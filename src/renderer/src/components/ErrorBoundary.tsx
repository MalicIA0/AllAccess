import { Component, type ReactNode } from 'react'

/**
 * Garde-fou global : capture toute erreur de rendu d'un composant enfant pour éviter
 * l'écran noir (renderer mort). Affiche un fallback lisible + un bouton pour recharger
 * la fenêtre. En dev, l'erreur reste visible dans la console.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown): void {
    console.error('[renderer] erreur non rattrapée :', error, info)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-5xl">😵‍💫</p>
        <h1 className="text-2xl font-black tracking-tight">Une erreur est survenue</h1>
        <p className="max-w-md text-sm text-vault-muted">
          L'interface a rencontré un problème inattendu. Tes données ne sont pas perdues — recharge la fenêtre pour
          repartir proprement.
        </p>
        <pre className="max-w-md overflow-auto rounded-lg bg-black/40 p-3 text-left text-[11px] text-red-300">
          {this.state.error.message}
        </pre>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-6 py-3 font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110"
        >
          ⟳ Recharger
        </button>
      </div>
    )
  }
}
