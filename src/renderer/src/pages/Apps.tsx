import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { AppItem } from '../../../shared/types'
import { PlatformBadge } from '../components/GameCard'

function AppCard({ app, onLaunch }: { app: AppItem; onLaunch: (id: string) => void }): React.JSX.Element {
  const [imgFailed, setImgFailed] = useState(false)
  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02, transition: { type: 'tween', duration: 0.15, ease: 'easeOut' } }}
      whileTap={{ scale: 0.98, transition: { type: 'tween', duration: 0.1 } }}
      onClick={() => onLaunch(app.id)}
      className="group relative aspect-[2/3] overflow-hidden rounded-2xl bg-vault-card text-left shadow-lg shadow-black/40 ring-1 ring-vault-border/60 transition-colors duration-150 ease-out hover:ring-vault-accent/60"
    >
      {app.coverUrl && !imgFailed ? (
        <img
          src={app.coverUrl}
          alt={app.name}
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-vault-card to-vault-panel p-3 text-center">
          <span className="text-sm font-bold text-vault-muted">{app.name}</span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-3 pt-10">
        <p className="truncate text-sm font-bold">{app.name}</p>
      </div>
      <div className="absolute top-2 right-2">
        <PlatformBadge platform={app.platform} />
      </div>
      {app.installed && (
        <div className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-vault-accent2">
          ⬇ INSTALLÉE
        </div>
      )}
    </motion.button>
  )
}

export default function Apps({ onSync }: { onSync: () => void }): React.JSX.Element {
  const [apps, setApps] = useState<AppItem[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = (): void => void window.api.getApps().then((a) => (setApps(a), setLoaded(true)))

  useEffect(() => {
    load()
    return window.api.onLibraryChanged(load)
  }, [])

  const launch = async (id: string): Promise<void> => {
    await window.api.launchApp(id)
  }

  if (loaded && apps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-6xl">📦</p>
        <h2 className="text-2xl font-bold">Aucune application détectée</h2>
        <p className="max-w-md text-vault-muted">
          Les outils et applications (hors jeux) de tes comptes Steam et Xbox apparaîtront ici, séparés de ta
          bibliothèque.
        </p>
        <button
          onClick={onSync}
          className="mt-2 rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 px-6 py-3 font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110"
        >
          ⟳ Synchroniser maintenant
        </button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-3xl font-black tracking-tight">
        Applications{' '}
        <span className="ml-2 align-middle text-sm font-semibold text-vault-muted">{apps.length}</span>
      </h1>
      <p className="mb-6 text-sm text-vault-muted">
        Outils et applications de tes comptes Steam et Xbox — séparés des jeux pour ne pas encombrer la bibliothèque.
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5 pb-8">
        {apps.map((a) => (
          <AppCard key={a.id} app={a} onLaunch={launch} />
        ))}
      </div>
    </div>
  )
}
