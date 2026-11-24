import type { Game, SyncProgress } from '../../shared/types'
import { isSteamConnected, verifySteamSession } from './steamAuth'
import { isXboxConnected } from './xboxAuth'
import { isEpicConnected } from './epicAuth'
import { fetchSteamLibrary, scanInstalledSteamGames, syncAllSteamAchievements, syncSteamDlc, syncSteamOnDiskGames } from './steam'
import { fetchXboxLibrary, syncAllXboxAchievements, syncXboxDlc, syncXboxOnDiskGames } from './xbox'
import { fetchEpicLibrary } from './epic'
import { scanInstalledRockstarGames } from './rockstar'
import { scanInstalledUbisoftGames } from './ubisoft'
import { detectInstalledApps, detectInstalledXboxGames } from './launcher'
import { getGames, hideCrossPlatformDuplicates, pruneApps, pruneGames, setGameInstalled, upsertApp, upsertGame } from './db'
import { fetchPurchasedApps } from './msStore'
import { achievementPoller } from './achievementPoller'

let syncing = false

export function isSyncing(): boolean {
  return syncing
}

/**
 * Met à jour l'état « installé » des jeux Steam depuis les appmanifest_*.acf locaux —
 * aucune connexion au compte requise. Retourne true si au moins une fiche a changé.
 */
async function syncSteamInstalledLocal(): Promise<boolean> {
  let changed = false
  const installedMap = await scanInstalledSteamGames()
  for (const g of getGames().filter((g) => g.platform === 'steam')) {
    const inst = installedMap.get(g.externalId)
    const isInstalled = !!inst
    const installDir = inst?.installDir ?? null
    if (isInstalled === g.installed && installDir === g.installDir) continue
    upsertGame({
      ...g,
      installed: isInstalled,
      installDir,
      exeHints: inst?.exeHints ?? g.exeHints
    })
    changed = true
  }
  return changed
}

/**
 * Rafraîchissement LOCAL de l'état installé (Steam via .acf, Xbox via menu Démarrer), sans
 * toucher au réseau. Appelé quand un téléchargement suivi vient de se terminer, pour que le
 * jeu passe dans « Installés — prêts à jouer » immédiatement, sans attendre la sync complète.
 */
export async function refreshInstalledLocal(): Promise<boolean> {
  let changed = false
  try {
    changed = await syncSteamInstalledLocal()
  } catch {
    /* best effort */
  }
  try {
    // Xbox : détection par menu Démarrer — fiable pour AJOUTER, pas pour retirer (un raté
    // ponctuel ne doit pas faire « désinstaller » un jeu réellement présent) → upgrade only.
    const xboxGames = getGames().filter((g) => g.platform === 'xbox' && !g.installed)
    if (xboxGames.length > 0) {
      const installed = await detectInstalledXboxGames(xboxGames)
      for (const g of xboxGames) {
        if (!installed.has(g.id)) continue
        upsertGame({ ...g, installed: true })
        changed = true
      }
    }
  } catch {
    /* best effort */
  }
  return changed
}

export async function runFullSync(report: (p: SyncProgress) => void): Promise<void> {
  if (syncing) return
  syncing = true
  const errors: string[] = []
  try {
    const steam = isSteamConnected()
    const xbox = isXboxConnected()
    const epic = isEpicConnected()

    if (!steam.connected && !xbox.connected && !epic.connected) {
      report({
        phase: 'Connexion requise',
        detail: '',
        done: true,
        error: 'Aucun compte connecté — va dans Réglages et connecte-toi à Steam, Xbox et/ou Epic.'
      })
      return
    }

    // Steam / Xbox / Epic / Rockstar / Ubisoft sont des sources indépendantes (comptes et API
    // distincts) — on les synchronise en parallèle plutôt qu'en séquence, ce qui divise à peu
    // près par le nombre de sources actives le temps total passé à attendre le réseau.
    const steamTask = steam.connected
      ? (async () => {
          try {
            // Vérifie que les cookies de session sont vivants (pas juste le jeton) : sinon les succès
            // Steam se lisent sur la vue publique déconnectée → compteurs faux. On prévient clairement.
            report({ phase: 'Steam', detail: 'Vérification de la session…', done: false })
            if (!(await verifySteamSession())) {
              errors.push('Steam : session expirée — reconnecte-toi dans les Réglages pour des succès à jour.')
            }
            report({ phase: 'Steam', detail: 'Bibliothèque…', done: false })
            const { games: steamGames, apps: steamApps } = await fetchSteamLibrary()
            pruneGames('steam', steamGames.map((g) => g.id))
            report({ phase: 'Steam', detail: `${steamGames.length} jeux trouvés`, done: false })
            await syncAllSteamAchievements(steamGames, (done, total, name) =>
              report({ phase: 'Steam', detail: `Succès ${done}/${total} — ${name}`, done: false })
            )

            // Outils/applications Steam (benchmarks, wallpapers…) — séparés des jeux
            for (const a of steamApps) upsertApp(a)
            pruneApps('steam', steamApps.map((a) => a.id))
          } catch (e) {
            errors.push(`Steam : ${(e as Error).message}`)
          }
        })()
      : (async () => {
          // Compte Steam non connecté (session expirée…) : l'état « installé » reste détectable
          // 100% en local via les appmanifest_*.acf — sans ça, un jeu installé/désinstallé
          // n'apparaîtrait jamais tant que l'utilisateur ne s'est pas reconnecté.
          try {
            report({ phase: 'Steam', detail: 'Détection locale des jeux installés…', done: false })
            await syncSteamInstalledLocal()
          } catch (e) {
            errors.push(`Steam (local) : ${(e as Error).message}`)
          }
        })()
    // Fait apparaître les jeux Steam présents sur disque (achat récent, téléchargement en cours)
    // MÊME si l'API Steam a échoué (token expiré) — 100 % local, tourne toujours après le bloc Steam.
    const steamDiskTask = steamTask.finally(async () => {
      try {
        await syncSteamOnDiskGames()
      } catch {
        /* best-effort : ne doit jamais faire échouer la synchro */
      }
    })

    const xboxTask = xbox.connected
      ? (async () => {
          try {
            report({ phase: 'Xbox', detail: 'Bibliothèque, achats + Game Pass…', done: false })
            const { games: xboxGames, safeToPrune } = await fetchXboxLibrary()
            // purge les titres exclus (console-only, anciens jeux Game Pass non achetés) — seulement si
            // la résolution du catalogue Store a réussi intégralement (sinon on risquerait de supprimer
            // un jeu réellement possédé à cause d'un simple échec réseau passager)
            if (safeToPrune) pruneGames('xbox', xboxGames.map((g) => g.id))
            const owned = xboxGames.filter((g) => g.ownership !== 'gamepass').length
            report({
              phase: 'Xbox',
              detail: `${xboxGames.length} jeux PC (${owned} achetés · ${xboxGames.length - owned} Game Pass)`,
              done: false
            })
            // Marque installés ceux présents dans le menu Démarrer — on met à jour l'objet en
            // mémoire (pas seulement la BDD) pour que la synchro des succès juste après filtre
            // correctement sur le statut d'installation à jour.
            // Statut « installé » dans LES DEUX SENS : on marque installés ceux détectés sur
            // disque, ET on démarque ceux qui ne le sont plus (jeu désinstallé). Sans le second
            // cas, un jeu supprimé restait affiché « installé / prêt » à vie (détection 100 %
            // locale et fiable via les StoreId des dossiers XboxGames, donc sûr d'y remettre false).
            const installed = await detectInstalledXboxGames(xboxGames)
            for (const g of xboxGames) {
              const isInstalled = installed.has(g.id)
              if (g.installed !== isInstalled) {
                g.installed = isInstalled // objet en mémoire à jour pour la synchro des succès juste après
                setGameInstalled(g.id, isInstalled)
              }
            }
            await syncAllXboxAchievements(
              xboxGames,
              (done, total, name) => report({ phase: 'Xbox', detail: `Succès ${done}/${total} — ${name}`, done: false }),
              // Un vrai déblocage repéré pendant la synchro globale déclenche aussi la bannière
              // (la base dédoublonne : si le poller l'a déjà vu, il n'est pas ré-émis).
              (game, achievement) => achievementPoller.emitUnlock(game, achievement)
            )

            // Applications (hors jeux) — catégorie séparée pour ne pas polluer la bibliothèque
            report({ phase: 'Xbox', detail: 'Applications…', done: false })
            const apps = await fetchPurchasedApps()
            const installedApps = await detectInstalledApps(apps.map((a) => a.title))
            const appIds: string[] = []
            for (const a of apps) {
              if (!a.productId) continue
              const id = `app:xbox:${a.productId}`
              appIds.push(id)
              upsertApp({
                id,
                platform: 'xbox',
                productId: a.productId,
                name: a.title,
                installed: installedApps.has(a.title),
                coverUrl: a.art.poster ?? a.art.hero
              })
            }
            pruneApps('xbox', appIds)
          } catch (e) {
            errors.push(`Xbox : ${(e as Error).message}`)
          } finally {
            // Réconciliation d'installation 100 % LOCALE (scan disque, aucun réseau) : tourne
            // TOUJOURS, même si l'API Xbox était en carafe (503) et a fait échouer fetchXboxLibrary
            // plus haut. Sans ça, un jeu fraîchement installé (ou désinstallé) ne se reflétait
            // jamais tant que l'API Xbox restait KO — c'est LA cause du « ça se met pas à jour ».
            try {
              // Crée d'abord les fiches des jeux Xbox/Game Pass installés mais absents de la base
              // (achat/installation récents, ou API en panne) — 100 % local.
              syncXboxOnDiskGames()
              const local = getGames().filter((g) => g.platform === 'xbox')
              const onDisk = await detectInstalledXboxGames(local)
              for (const g of local) {
                const isInstalled = onDisk.has(g.id)
                if (g.installed !== isInstalled) setGameInstalled(g.id, isInstalled)
              }
            } catch {
              /* best-effort : ne doit jamais faire échouer la synchro */
            }
          }
        })()
      : Promise.resolve()

    const epicTask = epic.connected
      ? (async () => {
          try {
            report({ phase: 'Epic', detail: 'Bibliothèque…', done: false })
            const { games: epicGames, safeToPrune } = await fetchEpicLibrary()
            // même précaution que pour Xbox : ne purge que si la résolution catalogue a réussi intégralement
            if (safeToPrune) pruneGames('epic', epicGames.map((g) => g.id))
            const withDlc = epicGames.filter((g) => g.dlcOwned > 0).length
            report({
              phase: 'Epic',
              detail: `${epicGames.length} jeux${withDlc ? ` · ${withDlc} avec DLC` : ''}`,
              done: false
            })
          } catch (e) {
            errors.push(`Epic : ${(e as Error).message}`)
          }
        })()
      : Promise.resolve()

    // Rockstar/Ubisoft : pas de compte, juste un scan local (fs) — rapide, mais autant le
    // paralléliser aussi puisqu'il ne dépend d'aucune des sources ci-dessus.
    const rockstarTask = (async () => {
      try {
        report({ phase: 'Rockstar', detail: 'Détection locale…', done: false })
        const rockstarGames = await scanInstalledRockstarGames()
        // scan local : liste vide = plus aucun jeu Rockstar installé → purge légitime
        pruneGames('rockstar', rockstarGames.map((g) => g.id), { allowEmpty: true })
        for (const g of rockstarGames) upsertGame(g)
        if (rockstarGames.length > 0) {
          report({ phase: 'Rockstar', detail: `${rockstarGames.length} jeu(x) détecté(s)`, done: false })
        }
      } catch (e) {
        errors.push(`Rockstar : ${(e as Error).message}`)
      }
    })()

    const ubisoftTask = (async () => {
      try {
        report({ phase: 'Ubisoft', detail: 'Détection locale…', done: false })
        const ubisoftGames = await scanInstalledUbisoftGames()
        // scan local : liste vide = plus aucun jeu Ubisoft installé → purge légitime
        pruneGames('ubisoft', ubisoftGames.map((g) => g.id), { allowEmpty: true })
        for (const g of ubisoftGames) upsertGame(g)
        if (ubisoftGames.length > 0) {
          report({ phase: 'Ubisoft', detail: `${ubisoftGames.length} jeu(x) détecté(s)`, done: false })
        }
      } catch (e) {
        errors.push(`Ubisoft : ${(e as Error).message}`)
      }
    })()

    await Promise.all([steamDiskTask, xboxTask, epicTask, rockstarTask, ubisoftTask])

    // DLC possédés (Steam + Xbox ; Epic déjà calculé pendant sa sync) — indépendants, en parallèle
    try {
      report({ phase: 'DLC', detail: 'Analyse des extensions possédées…', done: false })
      const all: Game[] = getGames()
      await Promise.all([
        steam.connected ? syncSteamDlc(all) : Promise.resolve(),
        xbox.connected ? syncXboxDlc(all) : Promise.resolve()
      ])
    } catch (e) {
      errors.push(`DLC : ${(e as Error).message}`)
    }

    // Un même jeu possédé sur plusieurs plateformes (ex. Destiny 2 sur Steam ET Xbox) ne doit
    // apparaître qu'une fois — masque automatiquement les copies redondantes (réversible).
    try {
      hideCrossPlatformDuplicates()
    } catch (e) {
      errors.push(`Doublons : ${(e as Error).message}`)
    }

    report({
      phase: 'Terminé',
      detail: errors.length ? '' : 'Synchronisation complète',
      done: true,
      error: errors.length ? errors.join(' · ') : undefined
    })
  } finally {
    syncing = false
  }
}
