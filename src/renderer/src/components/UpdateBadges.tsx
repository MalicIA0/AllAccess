import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { playUpdateAlarm } from '../lib/chimes'

/**
 * Pastilles de mise à jour — 3 briques DISTINCTES, chacune avec sa propre détection,
 * son propre voyant et sa propre notification :
 *   • All Access — l'application elle-même (nouvelle version installée)
 *   • Overlay    — HW Monitor (nouvelle version à appliquer via l'onglet Overlay)
 *   • HDR        — la fonctionnalité HDR (nouveautés)
 * Chaque pastille n'apparaît que si SON domaine a du nouveau non validé ; OK la valide
 * (mémorisé), et une future nouveauté la rallume. Une alarme sonore exclusive retentit
 * une fois au lancement si au moins une pastille est active.
 */

type BadgeId = 'allaccess' | 'overlay' | 'hdr'

// À incrémenter quand on ajoute des nouveautés à la fonctionnalité HDR.
const HDR_NEWS_VERSION = '1'

const META: Record<BadgeId, { emoji: string; label: string; color: string; sub: string }> = {
  allaccess: { emoji: '🎮', label: 'All Access', color: '#a78bfa', sub: "L'application" },
  overlay: { emoji: '📊', label: 'Overlay', color: '#38bdf8', sub: 'HW Monitor' },
  hdr: { emoji: '🌈', label: 'HDR', color: '#fbbf24', sub: 'Affichage HDR Windows' }
}

/**
 * Nouveautés de l'application, VERSION PAR VERSION. La pastille affiche tout ce qui a changé
 * depuis la dernière version validée par l'utilisateur (et pas seulement la toute dernière) :
 * en sautant plusieurs versions, on voit quand même l'ensemble des nouveautés.
 */
const ALLACCESS_NEWS: Record<string, string[]> = {
  '0.6.19': [
    'Succès Xbox plus fiables (réessais quand l’API Xbox répond mal)',
    'Détection du jeu Xbox en cours en ~10 secondes',
    'Jeux installés/désinstallés détectés même si l’API Xbox est en panne',
    'Bannière de succès affichée 10 secondes + 4 nouveaux sons',
    'Notifications de mise à jour séparées (All Access · Overlay · HDR)'
  ],
  '0.6.29': [
    'Réglages HDR regroupés dans leur onglet dédié',
    'Mise à jour automatique d’All Access au lancement',
    'Jeux Steam et Game Pass récents détectés sur le disque',
    'Les applications hors jeux ne polluent plus la Bibliothèque'
  ],
  '0.6.31': [
    'Bannière de succès enfin visible EN JEU : le premier plan est réaffirmé en continu',
    'Durée d’affichage de la bannière réglable (3 à 30 s)',
    'Style « Sticker » affiché au centre de l’écran'
  ],
  '0.6.32': [
    'Nouvel onglet Messages (conversations Xbox et Steam)',
    'Listes de succès Steam récupérées avec 3 tentatives au lieu d’abandonner en silence'
  ],
  '0.6.33': [
    'Messages : les conversations s’affichent enfin (elles étaient lues au mauvais endroit)',
    'Amis : le temps de jeu est compté depuis le lancement de l’appli, plus « 1 min » perpétuel'
  ],
  '0.6.34': ['Messages : ouverture d’une conversation, historique complet et réponse directe'],
  '0.6.35': [
    'Messages : le message envoyé s’affiche instantanément',
    'Messages : rafraîchissement automatique du fil toutes les 15 s',
    'Messages : l’erreur exacte est affichée si un envoi échoue'
  ],
  '0.6.36': ['Les pastilles de mise à jour indiquent la version et le détail des nouveautés'],
  '0.6.39': [
    'Un téléchargement en pause ou en file d’attente est signalé « ⏸ EN PAUSE »',
    'Correctif : les jeux Steam n’étaient plus détectés en double (bibliothèque comptée deux fois)',
    'La cause d’un téléchargement bloqué est affichée (« ⚠ DISQUE PLEIN », avec le détail au survol)',
    'L’alerte « disque plein » disparaît d’elle-même dès que l’espace est libéré'
  ],
  '0.6.40': [
    'Barre de téléchargement en temps réel : elle avance en continu au lieu de sauter',
    'Vitesse en Mo/s et temps restant affichés pendant le téléchargement',
    'Correctif : la progression estimée pouvait bondir à 99 % dès la première seconde'
  ]
}

const OVERLAY_NEWS = [
  'Résolution de rendu affichée entre la RAM et les FPS',
  'Code couleur de la résolution : 4K en or, 1440p en violet, 1080p en vert, en dessous en orange',
  'Compteur FPS enflammé au-dessus de 180 FPS',
  'CPU, GPU et RAM s’enflamment aussi quand ça chauffe vraiment',
  'Charge RAM colorée (vert / orange / rouge)',
  'Affichage des FPS même hors jeu',
  'Dispositions au choix : En ligne / En colonne / Mixte (⚙ sur l’overlay)',
  'Ligne HDR ON/OFF cliquable, en vert quand actif',
  'Max atteint affiché à côté de chaque valeur (CPU / GPU / RAM / FPS), masquable et remettable à zéro via ⚙'
]

/** Trie « 0.6.9 » < « 0.6.31 » correctement (comparaison numérique, pas alphabétique). */
function cmpVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** Nouveautés cumulées de toutes les versions postérieures à `since`, jusqu'à `current`. */
function newsSince(since: string | null, current: string): { version: string; items: string[] }[] {
  return Object.keys(ALLACCESS_NEWS)
    .filter((v) => cmpVersions(v, current) <= 0 && (!since || cmpVersions(v, since) > 0))
    .sort((a, b) => cmpVersions(b, a)) // plus récente en haut
    .map((v) => ({ version: v, items: ALLACCESS_NEWS[v] }))
}

const HDR_NEWS = [
  'Active ou coupe le HDR de Windows d’un seul clic, depuis la page Overlay',
  'État HDR ON/OFF affiché en direct dans l’overlay HW Monitor'
]

export default function UpdateBadges(): React.JSX.Element | null {
  const [active, setActive] = useState<Record<BadgeId, boolean>>({ allaccess: false, overlay: false, hdr: false })
  const [open, setOpen] = useState<BadgeId | null>(null)
  const [aaVersion, setAaVersion] = useState('')
  const [overlayHash, setOverlayHash] = useState('')
  const [overlayVersions, setOverlayVersions] = useState<{ embedded: string; installed: string }>({
    embedded: '',
    installed: ''
  })
  const rang = useRef(false)

  const check = useCallback(async () => {
    const version = await window.api.getAppVersion()
    setAaVersion(version)
    const perf = await window.api.checkPerfUpdate()
    setOverlayHash(perf.embeddedHash)
    setOverlayVersions({ embedded: perf.embeddedVersion ?? '', installed: perf.installedVersion ?? '' })
    setActive({
      allaccess: localStorage.getItem('ack_allaccess') !== version,
      overlay: perf.updateAvailable && localStorage.getItem('ack_overlay') !== perf.embeddedHash,
      hdr: localStorage.getItem('ack_hdr') !== HDR_NEWS_VERSION
    })
  }, [])

  useEffect(() => {
    void check()
    const onInstalled = (): void => void check()
    window.addEventListener('perf-installed', onInstalled)
    const id = setInterval(() => void check(), 15 * 60_000)
    return () => {
      window.removeEventListener('perf-installed', onInstalled)
      clearInterval(id)
    }
  }, [check])

  // Au lancement, si des pastilles sont actives : alarme sonore exclusive (une fois) +
  // une notification push Windows DISTINCTE par brique concernée (All Access / Overlay / HDR).
  useEffect(() => {
    if (rang.current) return
    const fresh = (['allaccess', 'overlay', 'hdr'] as BadgeId[]).filter((id) => active[id])
    if (fresh.length === 0) return
    rang.current = true
    playUpdateAlarm()
    for (const id of fresh) {
      // Le titre porte la VERSION concernée et le corps la première nouveauté : la notification
      // dit d'emblée de quelle mise à jour il s'agit, sans avoir à ouvrir la fenêtre.
      const version = id === 'allaccess' ? aaVersion : id === 'overlay' ? overlayVersions.embedded : ''
      const items =
        id === 'allaccess'
          ? (newsSince(localStorage.getItem('ack_allaccess'), aaVersion)[0]?.items ?? [])
          : id === 'overlay'
            ? OVERLAY_NEWS
            : HDR_NEWS
      const title = version ? `${META[id].label} ${version} — mise à jour` : `${META[id].label} — mise à jour`
      void window.api.notify(title, items[0] ?? 'Nouveautés disponibles')
    }
  }, [active, aaVersion, overlayVersions.embedded])

  const ack = (id: BadgeId): void => {
    if (id === 'allaccess') localStorage.setItem('ack_allaccess', aaVersion)
    else if (id === 'overlay') localStorage.setItem('ack_overlay', overlayHash)
    else localStorage.setItem('ack_hdr', HDR_NEWS_VERSION)
    setActive((a) => ({ ...a, [id]: false }))
    setOpen(null)
  }

  /** Sections de nouveautés affichées dans la fenêtre, groupées par version pour All Access. */
  const sectionsFor = (id: BadgeId): { version: string; items: string[] }[] => {
    if (id === 'allaccess') {
      const acked = localStorage.getItem('ack_allaccess')
      const groups = newsSince(acked, aaVersion)
      return groups.length > 0 ? groups : [{ version: aaVersion, items: ['Corrections et améliorations diverses.'] }]
    }
    if (id === 'overlay') return [{ version: overlayVersions.embedded, items: OVERLAY_NEWS }]
    return [{ version: '', items: HDR_NEWS }]
  }

  /** Numéro de version montré à côté du nom, pour savoir DE QUELLE mise à jour il s'agit. */
  const versionOf = (id: BadgeId): string =>
    id === 'allaccess' ? aaVersion : id === 'overlay' ? overlayVersions.embedded : ''

  const visible = (['allaccess', 'overlay', 'hdr'] as BadgeId[]).filter((id) => active[id])
  if (visible.length === 0) return null

  return (
    <div className="titlebar-nodrag flex h-full items-center">
      {visible.map((id) => (
        <button
          key={id}
          onClick={() => setOpen(id)}
          title={`Nouveautés — ${META[id].label} (${META[id].sub})`}
          className="group relative flex h-full items-center gap-1.5 px-2.5 transition hover:bg-white/5"
        >
          <span className="text-sm drop-shadow">{META[id].emoji}</span>
          <span className="text-[11px] font-bold" style={{ color: META[id].color }}>
            {META[id].label}
            {versionOf(id) && <span className="ml-1 font-semibold opacity-80">{versionOf(id)}</span>}
          </span>
          <motion.span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: '#ef4444', boxShadow: '0 0 6px #ef4444' }}
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </button>
      ))}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => ack(open)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="glass w-[440px] rounded-2xl border p-6 shadow-2xl shadow-black/60"
              style={{ borderColor: `${META[open].color}55` }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-3">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl"
                  style={{ backgroundColor: `${META[open].color}22` }}
                >
                  {META[open].emoji}
                </span>
                <div>
                  <p className="text-base font-black tracking-tight">
                    {META[open].label}
                    {versionOf(open) && (
                      <span className="ml-1.5" style={{ color: META[open].color }}>
                        {versionOf(open)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-vault-muted">
                    {META[open].sub}
                    {open === 'overlay' && overlayVersions.installed && (
                      <> · version installée : {overlayVersions.installed}</>
                    )}
                  </p>
                </div>
              </div>

              {/* Nouveautés groupées par version : on voit exactement CE QUI a changé, et dans quelle version */}
              <div className="mb-5 max-h-72 space-y-3 overflow-y-auto pr-1">
                {sectionsFor(open).map((sec) => (
                  <div key={sec.version || 'news'}>
                    {sec.version && (
                      <p className="mb-1 text-[11px] font-bold tracking-wide text-vault-muted">
                        Version {sec.version}
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {sec.items.map((t, i) => (
                        <li key={i} className="flex gap-2 text-sm text-vault-text">
                          <span style={{ color: META[open].color }}>•</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {open === 'overlay' && (
                <p className="mb-4 text-[11px] leading-relaxed text-vault-muted">
                  ℹ️ Pour appliquer la nouvelle version de l’overlay : onglet{' '}
                  <span className="font-semibold text-vault-text">Overlay</span> →{' '}
                  <span className="font-semibold text-vault-text">« ⟳ Réinstaller / mettre à jour »</span> (ferme
                  d’abord l’overlay s’il tourne).
                </p>
              )}

              <button
                onClick={() => ack(open)}
                className="w-full rounded-xl bg-gradient-to-r from-vault-accent to-vault-accent2 py-3 text-sm font-bold text-white shadow-lg shadow-vault-accent/25 transition hover:brightness-110 active:scale-[0.98]"
              >
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
