import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import type { Friend, FriendsResult } from '../../../shared/types'

/* ---------- « depuis X temps » ----------
   Le début de session est calculé par le PROCESSUS PRINCIPAL (`friend.sessionSince`), qui
   observe les amis en continu dès le lancement de l'appli. La page ne fait plus son propre
   suivi : quand il vivait ici, le chrono repartait à zéro chaque fois qu'on ouvrait l'onglet
   Amis, d'où un « depuis 1 min » perpétuel même après une heure de jeu. */

/** « 45 min », « 2h 15 », « 3 j » — pas de précision inutile au-delà de l'heure. */
function fmtDuration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m > 0 ? `${h}h ${m}` : `${h}h`
  return `${Math.floor(h / 24)} j`
}

function Avatar({ friend }: { friend: Friend }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const initials = friend.name.slice(0, 2).toUpperCase()
  return (
    <div className="relative h-12 w-12 shrink-0">
      {friend.avatarUrl && !failed ? (
        <img
          src={friend.avatarUrl}
          alt=""
          onError={() => setFailed(true)}
          className="h-12 w-12 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-vault-accent to-vault-accent2 text-sm font-black text-white">
          {initials}
        </div>
      )}
    </div>
  )
}

function FriendCard({
  friend,
  index,
  now
}: {
  friend: Friend
  index: number
  now: number
}): React.JSX.Element {
  // Ligne de statut « galère depuis X sur Y » quand on connaît le début de session ; sinon le statut brut.
  const statusLine =
    friend.game && friend.sessionSince
      ? `😅 galère depuis ${fmtDuration(now - friend.sessionSince)} sur ${friend.game}`
      : friend.game
        ? `🎮 ${friend.status}`
        : friend.status
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.012, 0.3), duration: 0.25 }}
      className={`glass relative flex items-center gap-3 rounded-2xl p-3 pb-4 ${friend.online ? '' : 'opacity-75'}`}
    >
      <Avatar friend={friend} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-vault-text">{friend.name}</p>
        </div>
        <p
          className={`mt-0.5 break-words text-xs ${friend.game ? 'font-semibold text-vault-accent2' : 'text-vault-muted'}`}
        >
          {statusLine}
        </p>
      </div>
      {/* fin trait de statut, aligné sous le pseudo (après l'avatar) : vert en ligne, rouge hors ligne — discret */}
      <span
        className={`pointer-events-none absolute bottom-1.5 left-[72px] w-20 h-[2px] rounded-full ${
          friend.online
            ? 'bg-emerald-400/60 shadow-[0_0_5px_0_rgba(52,211,153,0.45)]'
            : 'bg-red-500/60 shadow-[0_0_5px_0_rgba(239,68,68,0.4)]'
        }`}
      />
    </motion.div>
  )
}

export default function Friends({ connected }: { connected: boolean }): React.JSX.Element {
  const [data, setData] = useState<FriendsResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')

  // Horloge qui tique : fait avancer tout seul le « depuis X temps » entre deux rafraîchissements.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // Fusionne le nouveau résultat avec l'ancien : si une plateforme a échoué ce tour-ci
  // (ex. jeton Xbox pile à l'expiration), on CONSERVE ses amis précédents au lieu de les
  // effacer — la liste ne disparaît jamais à cause d'un simple à-coup réseau/token.
  const applyResult = useCallback((r: FriendsResult): void => {
    setData((prev) => {
      if (!prev) return r
      const failedSteam = r.errors.some((e) => e.startsWith('Steam'))
      const failedXbox = r.errors.some((e) => e.startsWith('Xbox'))
      if (!failedSteam && !failedXbox) return r
      const kept = prev.friends.filter(
        (f) => (f.platform === 'steam' && failedSteam) || (f.platform === 'xbox' && failedXbox)
      )
      const merged = [...r.friends, ...kept].sort((a, b) =>
        a.online !== b.online ? (a.online ? -1 : 1) : a.name.localeCompare(b.name)
      )
      return { friends: merged, errors: r.errors }
    })
  }, [])

  // Rechargement manuel (bouton « Actualiser ») ou automatique : force un nouvel appel.
  // Grâce au retry 401 + régénération de token côté back, ça remonte les amis même après des heures.
  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      applyResult(await window.api.getFriends())
    } finally {
      setRefreshing(false)
    }
  }, [applyResult])

  useEffect(() => {
    void refresh()
    // rafraîchissement automatique selon la fréquence réglée dans Réglages → Comportement
    let id: ReturnType<typeof setInterval> | null = null
    void window.api.getSettings().then((s) => {
      const minutes = Math.max(1, s.pollFriendsMin || 15)
      id = setInterval(() => void refresh(), minutes * 60_000)
    })
    return () => {
      if (id) clearInterval(id)
    }
  }, [refresh])

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.toLowerCase().trim()
    return data.friends.filter((f) => !q || f.name.toLowerCase().includes(q))
  }, [data, search])

  // Les amis en ligne sont déjà remontés en premier par le backend (tri en ligne puis nom) ; on
  // n'affiche PLUS de sections séparées — une seule liste, l'état se lit au code couleur (pastille
  // de présence + barre néon verte/rouge). On garde juste le décompte « en ligne » pour le titre.
  const online = filtered.filter((f) => f.online)

  if (!connected) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-6xl">👥</p>
        <h2 className="text-2xl font-bold">Connecte tes comptes</h2>
        <p className="max-w-md text-vault-muted">
          Connecte Steam et/ou Xbox dans les Réglages pour retrouver ici tes amis, voir qui est en ligne et à quoi ils
          jouent.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-3xl font-black tracking-tight">
          Amis{' '}
          {data && (
            <span className="ml-2 align-middle text-sm font-semibold text-vault-muted">
              {online.length} en ligne · {filtered.length} au total
            </span>
          )}
        </h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un ami…"
          className="glass w-64 rounded-xl px-4 py-2 text-sm outline-none placeholder:text-vault-muted focus:border-vault-accent/50"
        />
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          title="Actualiser la liste d'amis"
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-vault-muted transition hover:text-vault-text disabled:opacity-50"
        >
          <span className={`inline-block ${refreshing ? 'animate-spin' : ''}`}>⟳</span>
          {refreshing ? 'Actualisation…' : 'Actualiser'}
        </button>
      </div>

      {data && data.errors.length > 0 && (
        <div className="mb-6 rounded-xl border border-vault-gold/40 bg-vault-gold/10 px-4 py-3 text-xs text-vault-gold">
          ⚠ Certains amis n'ont pas pu être chargés : {data.errors.join(' · ')} — réessaie ou reconnecte le compte
          concerné dans les Réglages.
        </div>
      )}

      {data === null ? (
        <div className="flex max-w-sm flex-col gap-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="skeleton h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-5xl">🫥</p>
          <h2 className="text-xl font-bold">Aucun ami à afficher</h2>
          <p className="max-w-md text-sm text-vault-muted">
            {data.friends.length === 0
              ? 'Ta liste d’amis est vide, ou ta liste Steam est privée. Sur Steam, règle « Amis » sur Public dans la confidentialité du profil.'
              : 'Aucun ami ne correspond à ce filtre.'}
          </p>
        </div>
      ) : (
        <div className="flex max-w-sm flex-col gap-3 pb-8">
          {filtered.map((f, i) => (
            <FriendCard key={f.id} friend={f} index={i} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}
