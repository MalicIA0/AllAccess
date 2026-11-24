import { BrowserWindow, Notification, app, ipcMain, shell } from 'electron'
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { AppSettings, DashboardStats, DiskInfo, GamePassEntry, Ownership } from '../shared/types'

const execFileAsync = promisify(execFile)

/** Espace disque des lecteurs fixes (DriveType=3) via WMI — utilisé/libre/total en Go. */
async function getDiskUsage(): Promise<DiskInfo[]> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress"
    ])
    const parsed = stdout.trim() ? (JSON.parse(stdout) as unknown) : []
    const rows = (Array.isArray(parsed) ? parsed : [parsed]) as { DeviceID: string; Size: number; FreeSpace: number }[]
    const GB = 1024 ** 3
    return rows
      .filter((d) => d && Number(d.Size) > 0)
      .map((d) => {
        const total = Number(d.Size)
        const free = Number(d.FreeSpace)
        return { drive: d.DeviceID, totalGb: total / GB, freeGb: free / GB, usedGb: (total - free) / GB }
      })
  } catch {
    return []
  }
}
import {
  deleteGame,
  getAchievements,
  getApp,
  getApps,
  getGame,
  getGames,
  getStats,
  rowToPublicAchievement,
  rowToSession,
  setDlcManual,
  setGameHidden,
  setManualAchievementUnlock,
  setOwnershipOverride,
  upsertGame
} from './services/db'
import { getSettings, saveSettings } from './services/settings'
import { isSteamConnected, steamLogin, steamLogout, verifySteamSession } from './services/steamAuth'
import { isXboxConnected, xboxLogin, xboxLogout } from './services/xboxAuth'
import { epicLogin, epicLogout, isEpicConnected } from './services/epicAuth'
import {
  detectInstalledApps,
  installEvents,
  launchGame,
  launchOrInstallApp,
  openXboxApp,
  uninstallGame
} from './services/launcher'
import {
  extractProductId,
  getGamePassEntries,
  getGamePassRecent,
  normalizeName,
  resolveXboxTitleId,
  type CatalogEntry
} from './services/gamepass'
import type { DownloadInfo, InstallProgressEvent } from '../shared/types'
import { runFullSync, isSyncing, refreshInstalledLocal } from './services/sync'
import { fetchFriends } from './services/friends'
import { fetchMessages, fetchXboxThread, sendXboxMessage } from './services/messages'
import { fetchSteamCatalog, fetchSteamFreeGames, fetchSteamPromos } from './services/steamStore'
import { fetchXboxDeals } from './services/xboxStore'
import { syncSteamAchievements } from './services/steam'
import { normalizeLabel, readLocalSteamUnlocks } from './services/steamLocalStats'
import { fetchXboxBonusAchievements, syncXboxAchievements } from './services/xbox'
import { processWatcher } from './services/processWatcher'
import { achievementPoller } from './services/achievementPoller'
import { scanXboxDownloads, setDownloadTotal } from './services/xboxDownload'
import { scanXboxPreloads } from './services/xboxPreload'
import { scanSteamDownloads } from './services/steamDownload'

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  /* ----- réglages ----- */
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, s: AppSettings) => {
    saveSettings(s)
    app.setLoginItemSettings({ openAtLogin: s.autostart, args: ['--hidden'] })
  })

  /* ----- comptes ----- */
  ipcMain.handle('auth:status', () => ({
    steam: isSteamConnected(),
    xbox: isXboxConnected(),
    epic: isEpicConnected()
  }))
  ipcMain.handle('friends:get', () => fetchFriends())
  ipcMain.handle('messages:get', () => fetchMessages())
  ipcMain.handle('messages:thread', (_e, peerId: string) => fetchXboxThread(peerId))
  // Envoi déclenché par le bouton « Envoyer » de la page Messages (action explicite de l'utilisateur).
  ipcMain.handle('messages:send', (_e, peerId: string, text: string) => sendXboxMessage(peerId, text))
  // vérifie que la session Steam (cookies) est réellement vivante — pas juste un jeton stocké
  ipcMain.handle('auth:steam:verify', () => verifySteamSession())
  ipcMain.handle('auth:steam:login', async () => {
    try {
      const r = await steamLogin(getWindow())
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('auth:xbox:login', async () => {
    try {
      const r = await xboxLogin(getWindow())
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('auth:epic:login', async () => {
    try {
      const r = await epicLogin(getWindow())
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('auth:steam:logout', () => steamLogout())
  ipcMain.handle('auth:xbox:logout', () => xboxLogout())
  ipcMain.handle('auth:epic:logout', () => epicLogout())

  /* ----- bibliothèque ----- */
  ipcMain.handle('library:get', () => getGames())
  ipcMain.handle('game:get', (_e, id: string) => ({ game: getGame(id), achievements: getAchievements(id) }))
  ipcMain.handle('game:launch', async (_e, id: string) => {
    const game = getGame(id)
    if (!game) return { ok: false, error: 'Jeu inconnu' }
    return launchGame(game)
  })
  ipcMain.handle('game:setOwnership', (_e, id: string, ownership: Ownership | null) => {
    setOwnershipOverride(id, ownership)
    send('library:changed', null)
  })
  ipcMain.handle('game:setHidden', (_e, id: string, hidden: boolean) => {
    setGameHidden(id, hidden)
    send('library:changed', null)
  })
  ipcMain.handle('game:delete', (_e, id: string) => {
    deleteGame(id)
    send('library:changed', null)
  })
  ipcMain.handle('game:setDlcManual', (_e, id: string, owned: number, total: number) => {
    setDlcManual(id, owned, total)
    send('library:changed', null)
  })
  ipcMain.handle('game:uninstall', async (_e, id: string, deleteSave: boolean) => {
    const game = getGame(id)
    if (!game) return { ok: false, error: 'Jeu inconnu' }
    const r = await uninstallGame(game, deleteSave)
    // Optimiste : pour Steam/Rockstar/Ubisoft/Epic la désinstallation réelle se termine hors de
    // notre contrôle (fenêtre externe) — la prochaine sync corrige l'état si besoin.
    if (r.ok) {
      upsertGame({ ...game, installed: false })
      send('library:changed', null)
    }
    return r
  })
  ipcMain.handle('game:refreshAchievements', async (_e, id: string) => {
    const game = getGame(id)
    if (!game) return []
    try {
      // Rockstar/Epic/Ubisoft n'exposent aucune API de succès — inutile d'appeler l'API Xbox pour eux
      if (game.platform === 'steam') await syncSteamAchievements(game.externalId)
      else if (game.platform === 'xbox') await syncXboxAchievements(game.externalId)
    } catch {
      /* API indisponible */
    }
    return getAchievements(id)
  })
  // Import manuel de la liste de succès Xbox d'un jeu, pour un jeu possédé sur une autre
  // plateforme (ex. Steam) — suivi 100% local, jamais synchronisé avec le vrai compte Xbox.
  ipcMain.handle('game:linkXboxAchievements', async (_e, id: string, urlOrId: string) => {
    const game = getGame(id)
    if (!game) return { ok: false, error: 'Jeu inconnu' }
    const productId = extractProductId(urlOrId)
    if (!productId) return { ok: false, error: 'Lien ou identifiant Microsoft Store invalide.' }
    try {
      const resolved = await resolveXboxTitleId(productId)
      if (!resolved) return { ok: false, error: "Ce produit n'a pas de fiche Xbox correspondante." }
      const list = await fetchXboxBonusAchievements(resolved.titleId, id)
      if (list.length === 0) return { ok: false, error: 'Aucun succès Xbox trouvé pour ce titre.' }
      send('library:changed', null)
      return { ok: true, count: list.length, title: resolved.title }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  /**
   * « Revivre » les succès obtenus pendant que le compte Steam était déconnecté : on lit le cache
   * local du client Steam (aucun réseau, aucune session nécessaire), on rapproche par LIBELLÉ — les
   * clés en base sont des empreintes issues du scraping HTML, pas les noms d'API Steam — et on
   * marque les manquants avec leur DATE RÉELLE. Les bannières sont ensuite rejouées dans l'ordre
   * chronologique, espacées, pour que la série se regarde comme elle se serait déroulée.
   */
  ipcMain.handle('achievement:recoverOffline', async (_e, gameId: string) => {
    const game = getGame(gameId)
    if (!game || game.platform !== 'steam') return { ok: false, error: 'Réservé aux jeux Steam.' }

    const local = await readLocalSteamUnlocks(game.externalId)
    if (local.length === 0)
      return { ok: false, error: "Aucun cache de succès Steam trouvé sur ce PC pour ce jeu." }

    const byLabel = new Map(getAchievements(gameId).map((a) => [normalizeLabel(a.name), a]))
    const recovered: { key: string; at: number }[] = []
    let redated = 0
    for (const u of local) {
      const a = byLabel.get(normalizeLabel(u.label))
      if (!a) continue // succès inconnu en base
      if (!a.unlocked) {
        setManualAchievementUnlock(gameId, a.key, true, u.unlockTime ?? Date.now())
        recovered.push({ key: a.key, at: u.unlockTime ?? Date.now() })
      } else if (u.unlockTime && Math.abs((a.unlockTime ?? 0) - u.unlockTime) > 60_000) {
        // déjà crédité, mais avec l'heure de la SYNCHRO faute de mieux (les pages communautaires
        // Steam ne donnent pas l'heure) : le cache local, lui, la connaît → on corrige l'historique,
        // silencieusement, sans rejouer de bannière pour un succès déjà vu.
        setManualAchievementUnlock(gameId, a.key, true, u.unlockTime)
        redated++
      }
    }
    send('library:changed', null)

    const achievements = getAchievements(gameId)
    // rejeu chronologique, espacé : l'overlay empile déjà les notifications, ce délai évite
    // seulement qu'une rafale de dix succès défile trop vite pour être lue
    recovered.sort((a, b) => a.at - b.at)
    void (async () => {
      for (const r of recovered) {
        const a = achievements.find((x) => x.key === r.key)
        if (a) achievementPoller.emitUnlock(game, a)
        await new Promise((res) => setTimeout(res, 1_200))
      }
    })()

    return {
      ok: true,
      achievements,
      recovered: recovered.length,
      redated,
      trouves: local.length,
      noms: recovered
        .map((r) => achievements.find((x) => x.key === r.key)?.name ?? '')
        .filter(Boolean)
    }
  })

  // Cochable à la main sur N'IMPORTE QUEL succès, pas seulement les bonus Xbox : la liste
  // complète d'un jeu est stockée en base dès la première synchro, donc elle reste exploitable
  // hors ligne ou compte de plateforme déconnecté. Aucun risque de perdre le pointage : la clause
  // « unlocked = MAX(ancien, nouveau) » de upsertAchievements empêche une synchro ultérieure de
  // reverrouiller un succès (voir db.ts). Seule la clé doit exister, pour ne pas créer de fantôme.
  ipcMain.handle('achievement:toggleManual', (_e, gameId: string, key: string, unlocked: boolean) => {
    if (!getAchievements(gameId).some((a) => a.key === key))
      return { ok: false, error: 'Succès introuvable pour ce jeu.' }
    setManualAchievementUnlock(gameId, key, unlocked)
    const achievements = getAchievements(gameId)
    // même célébration (bannière + son) qu'un vrai déblocage — c'est tout l'intérêt du suivi manuel
    if (unlocked) {
      const game = getGame(gameId)
      const achievement = achievements.find((a) => a.key === key)
      if (game && achievement) achievementPoller.emitUnlock(game, achievement)
    }
    send('library:changed', null)
    return { ok: true, achievements }
  })

  /* ----- applications (hors jeux) ----- */
  ipcMain.handle('apps:get', () => getApps())
  ipcMain.handle('app:launch', async (_e, id: string) => {
    const item = getApp(id)
    if (!item) return { ok: false, error: 'Application inconnue' }
    return launchOrInstallApp(item)
  })

  /* ----- catalogue Game Pass (tous les jeux actuellement dans l'abonnement) ----- */
  async function toGamePassEntries(entries: CatalogEntry[]): Promise<GamePassEntry[]> {
    const xboxGames = getGames().filter((g) => g.platform === 'xbox')
    const byName = new Map(xboxGames.map((g) => [normalizeName(g.name), g]))
    // détection "installé" par le menu Démarrer (même source que la bibliothèque)
    const installedNames = await detectInstalledApps(entries.map((e) => e.title)).catch(() => new Set<string>())
    return entries.map((e) => {
      const lib = byName.get(normalizeName(e.title)) ?? null
      return {
        productId: e.productId,
        title: e.title,
        poster: e.poster,
        hero: e.hero,
        pc: e.pc,
        console: e.console,
        inLibrary: !!lib,
        libraryGameId: lib?.id ?? null,
        installed: (lib?.installed ?? false) || installedNames.has(e.title)
      }
    })
  }
  ipcMain.handle('gamepass:catalog', async (): Promise<GamePassEntry[]> => toGamePassEntries(await getGamePassEntries()))
  ipcMain.handle('gamepass:recent', async (): Promise<GamePassEntry[]> => toGamePassEntries(await getGamePassRecent()))

  /* ----- promos Steam (catalogue public, aucun compte requis) ----- */
  ipcMain.handle('store:steamPromos', () => fetchSteamPromos())
  ipcMain.handle('store:steamCatalog', () => fetchSteamCatalog())
  ipcMain.handle('store:steamFree', () => fetchSteamFreeGames())
  /* ----- promos du Store Xbox (page publique xbox.com, aucun compte requis) ----- */
  ipcMain.handle('store:xboxDeals', () => fetchXboxDeals())
  // lance le jeu s'il est installé, sinon installation winget ou fiche Store
  ipcMain.handle('gamepass:open', (_e, productId: string, title: string) =>
    launchOrInstallApp({
      id: `gp:${productId}`,
      platform: 'xbox',
      productId,
      name: title,
      installed: false,
      coverUrl: null,
      updatedAt: Date.now()
    })
  )

  /* ----- sync ----- */
  ipcMain.handle('sync:run', () => {
    if (isSyncing()) return
    void runFullSync((p) => {
      send('sync:progress', p)
      if (p.done) send('library:changed', null)
    })
  })
  ipcMain.handle('sync:isRunning', () => isSyncing())
  // Rafraîchissement LOCAL de l'état « installé » (fichiers .acf Steam + menu Démarrer Xbox) —
  // aucun accès réseau, quasi instantané. Sert au timer périodique et au bouton « Actualiser » :
  // un jeu fraîchement installé passe dans « Installés » sans attendre la grosse sync (10 min) ni
  // dépendre du suivi de téléchargement (qui rate les installs faites appli fermée / trop rapides).
  ipcMain.handle('sync:refreshInstalled', async () => {
    const changed = await refreshInstalledLocal()
    if (changed) send('library:changed', null)
    return changed
  })

  /* ----- dashboard ----- */
  ipcMain.handle('stats:get', (): DashboardStats => {
    const { games, recentUnlocks, recentSessions, nextChallenges } = getStats()
    const g = games.map((r) => ({
      ownership: (r.ownership_override as string) || (r.ownership as string),
      installed: !!r.installed,
      total: r.achievements_total as number,
      unlocked: r.achievements_unlocked as number,
      playtime: r.playtime_minutes as number
    }))
    return {
      // « totalGames » = jeux possédés (hors Game Pass seul) ; plus affiché tel quel au Dashboard,
      // qui montre désormais « Jeux installés » à la place pour éviter le doublon avec « Achetés ».
      totalGames: g.filter((x) => x.ownership !== 'gamepass').length,
      ownedGames: g.filter((x) => x.ownership === 'owned' || x.ownership === 'both').length,
      gamepassGames: g.filter((x) => x.ownership === 'gamepass' || x.ownership === 'both').length,
      // Tous les jeux installés, toutes plateformes (même critère que la section « Installés — prêts
      // à jouer » de la bibliothèque) — c'est la valeur affichée par la tuile « Jeux installés ».
      installedGames: g.filter((x) => x.installed).length,
      totalAchievements: g.reduce((s, x) => s + x.total, 0),
      unlockedAchievements: g.reduce((s, x) => s + x.unlocked, 0),
      playtimeMinutes: g.reduce((s, x) => s + x.playtime, 0),
      perfectGames: g.filter((x) => x.total > 0 && x.unlocked === x.total).length,
      recentUnlocks: recentUnlocks.map((r) => ({
        ...rowToPublicAchievement(r),
        gameName: r.game_name as string,
        coverUrl: (r.game_cover as string | null) ?? null
      })),
      recentSessions: recentSessions.map((r) => ({ ...rowToSession(r), gameName: r.game_name as string })),
      nextChallenges: nextChallenges.map((r) => ({
        ...rowToPublicAchievement(r),
        gameName: r.game_name as string,
        coverUrl: (r.game_cover as string | null) ?? null
      }))
    }
  })

  /* ----- fenêtre (titlebar custom) ----- */
  ipcMain.on('window:minimize', () => getWindow()?.minimize())
  ipcMain.on('window:maximize', () => {
    const w = getWindow()
    if (!w) return
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('window:close', () => getWindow()?.hide()) // résident : close = cacher

  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('disk:usage', () => getDiskUsage())

  /* ----- téléchargements en cours, toutes plateformes (barre de progression) ----- */
  // Suivi de fin : quand un téléchargement présent au poll précédent disparaît, on rafraîchit
  // l'état « installé » en local (sans attendre la sync complète) et on notifie l'interface →
  // le jeu passe de « En téléchargement » à « Installés — prêts à jouer » automatiquement,
  // avec toast + entrée dans la cloche de notifications (via game:installProgress).
  const dlKey = (d: DownloadInfo): string => `${d.platform}:${d.storeId ?? d.name}`
  const dlNorm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  let prevDownloads: DownloadInfo[] = []
  ipcMain.handle('downloads:active', async () => {
    const list = [...scanXboxDownloads(), ...(await scanSteamDownloads())]
    const currentKeys = new Set(list.map(dlKey))
    const finished = prevDownloads.filter((d) => !currentKeys.has(dlKey(d)))
    prevDownloads = list
    if (finished.length > 0) {
      void refreshInstalledLocal().then((changed) => {
        if (changed) send('library:changed', null)
        // Annonce uniquement si le jeu est réellement installé maintenant — un téléchargement
        // ANNULÉ disparaît aussi de la liste, mais ne doit pas être fêté.
        for (const d of finished) {
          const game =
            d.platform === 'steam'
              ? getGame(`steam:${d.storeId}`)
              : (getGames().find((g) => g.platform === 'xbox' && d.storeId && g.storeProductId === d.storeId) ??
                getGames().find((g) => g.platform === 'xbox' && dlNorm(g.name) === dlNorm(d.name)) ??
                null)
          if (game?.installed) {
            const e: InstallProgressEvent = { gameId: game.id, gameName: game.name, status: 'done' }
            send('game:installProgress', e)
          }
        }
      })
    }
    return list
  })
  ipcMain.handle('downloads:setTotal', (_e, storeId: string, totalBytes: number) => {
    setDownloadTotal(storeId, totalBytes)
  })

  /* ----- jeux Xbox préchargés (« à venir ») : sur disque mais pas encore sortis ----- */
  ipcMain.handle('xbox:preloads', () => scanXboxPreloads())

  /* ----- « Voir plus » du Catalogue : ouvre directement l'appli native ----- */
  // Ouvre l'appli Xbox (qui contient le Game Pass) ; retombe sur la page Store si absente.
  ipcMain.handle('catalog:openGamePassApp', async () => {
    if (await openXboxApp()) return { ok: true }
    await shell.openExternal('ms-windows-store://navigatetopage/?Id=Gamepass')
    return { ok: true }
  })
  // Ouvre le client Steam directement sur le magasin (ou la page des promos).
  ipcMain.handle('catalog:openSteamStore', (_e, view: 'catalog' | 'promos') => {
    const url = view === 'promos' ? 'https://store.steampowered.com/specials' : 'https://store.steampowered.com/'
    void shell.openExternal(`steam://openurl/${url}`)
  })

  /* ----- overlay Performances (HwMonitor : CPU/GPU/RAM/FPS) -----
     Les binaires sont EMBARQUÉS dans resources/perf (décompressés, hors asar).
     « Installer » = les copier dans %LOCALAPPDATA%\Programs\HW Monitor + raccourci
     bureau — l'overlay devient alors indépendant d'All Access (lançable seul). */
  const perfSrcDir = (): string =>
    app.isPackaged ? join(process.resourcesPath, 'perf') : join(app.getAppPath(), 'resources', 'perf')
  const perfDstDir = (): string =>
    join(process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local'), 'Programs', 'HW Monitor')

  ipcMain.handle('perf:status', () => ({
    installed: existsSync(join(perfDstDir(), 'HwMonitor.exe')),
    installDir: perfDstDir()
  }))

  /* Détection de mise à jour de l'overlay : on compare le binaire EMBARQUÉ dans
     All Access à la copie INSTALLÉE (hash MD5 en flux, les exe font ~65 Mo).
     RIEN n'est installé automatiquement ici — on ne fait que détecter ; c'est
     la sonnette côté interface qui prévient, et l'utilisateur applique la mise
     à jour depuis l'onglet Overlay quand il le décide. */
  const hashFile = (p: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const h = createHash('md5')
      createReadStream(p)
        .on('data', (d) => h.update(d))
        .on('end', () => resolve(h.digest('hex')))
        .on('error', reject)
    })

  /* Version d'un .exe (ressource VERSIONINFO Windows) — sert à nommer précisément la mise à
     jour de l'overlay dans la pastille. Mise en cache par chemin+mtime : la lecture passe par
     PowerShell, inutile de la refaire tant que le fichier n'a pas changé. */
  const versionCache = new Map<string, string>()
  const exeVersion = async (p: string): Promise<string> => {
    try {
      const key = `${p}:${statSync(p).mtimeMs}`
      const hit = versionCache.get(key)
      if (hit !== undefined) return hit
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${p}').VersionInfo.ProductVersion`],
        { windowsHide: true, timeout: 10_000 }
      )
      const v = stdout.trim().replace(/\.0$/, '') // « 1.0.10.0 » → « 1.0.10 »
      versionCache.set(key, v)
      return v
    } catch {
      return '' // version inconnue : l'interface se rabat sur la date du fichier
    }
  }

  /* ----- HDR Windows (advanced color) : lecture + bascule via l'API CCD -----
     Pas d'admin requis. Le script PowerShell compile à la volée le P/Invoke CCD
     (même code validé que HW Monitor) et agit sur tous les écrans HDR-capables. */
  const HDR_PS1 = `param([string]$Action='status')
$cs = @'
using System;
using System.Runtime.InteropServices;
public static class Hdr {
  const uint QDC=0x2; const int GETI=9; const int SETS=10;
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint L; public int H; }
  [StructLayout(LayoutKind.Sequential)] public struct RAT { public uint N; public uint D; }
  [StructLayout(LayoutKind.Sequential)] public struct PSRC { public LUID a; public uint id; public uint mi; public uint sf; }
  [StructLayout(LayoutKind.Sequential)] public struct PTGT { public LUID a; public uint id; public uint mi; public uint ot; public uint ro; public uint sc; public RAT rr; public uint sl; public int av; public uint sf; }
  [StructLayout(LayoutKind.Sequential)] public struct PINFO { public PSRC s; public PTGT t; public uint f; }
  [StructLayout(LayoutKind.Sequential, Size=48)] public struct MU { }
  [StructLayout(LayoutKind.Sequential)] public struct MINFO { public uint it; public uint id; public LUID a; public MU m; }
  [StructLayout(LayoutKind.Sequential)] public struct HDR_H { public int type; public uint size; public LUID a; public uint id; }
  [StructLayout(LayoutKind.Sequential)] public struct GADV { public HDR_H h; public uint v; public int ce; public int bpc; }
  [StructLayout(LayoutKind.Sequential)] public struct SADV { public HDR_H h; public uint v; }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint f, out uint np, out uint nm);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint f, ref uint np, [Out] PINFO[] p, ref uint nm, [Out] MINFO[] m, IntPtr t);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref GADV p);
  [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref SADV p);
  static PINFO[] Paths() {
    uint np, nm;
    if (GetDisplayConfigBufferSizes(QDC, out np, out nm)!=0) return new PINFO[0];
    var p=new PINFO[np]; var m=new MINFO[nm];
    if (QueryDisplayConfig(QDC, ref np, p, ref nm, m, IntPtr.Zero)!=0) return new PINFO[0];
    Array.Resize(ref p, (int)np); return p;
  }
  public static bool CurrentEnabled() {
    foreach (var pi in Paths()) {
      var g=new GADV(); g.h.type=GETI; g.h.size=(uint)Marshal.SizeOf(typeof(GADV)); g.h.a=pi.t.a; g.h.id=pi.t.id;
      if (DisplayConfigGetDeviceInfo(ref g)==0 && (g.v&0x2)!=0) return true;
    }
    return false;
  }
  public static string GetStateStr() {
    bool sup=false, en=false;
    foreach (var pi in Paths()) {
      var g=new GADV(); g.h.type=GETI; g.h.size=(uint)Marshal.SizeOf(typeof(GADV)); g.h.a=pi.t.a; g.h.id=pi.t.id;
      if (DisplayConfigGetDeviceInfo(ref g)==0) { if((g.v&0x1)!=0) sup=true; if((g.v&0x2)!=0) en=true; }
    }
    return "supported=" + (sup?"1":"0") + ";enabled=" + (en?"1":"0");
  }
  public static bool SetHdr(bool e) {
    bool any=false;
    foreach (var pi in Paths()) {
      var g=new GADV(); g.h.type=GETI; g.h.size=(uint)Marshal.SizeOf(typeof(GADV)); g.h.a=pi.t.a; g.h.id=pi.t.id;
      if (DisplayConfigGetDeviceInfo(ref g)!=0 || (g.v&0x1)==0) continue;
      var s=new SADV(); s.h.type=SETS; s.h.size=(uint)Marshal.SizeOf(typeof(SADV)); s.h.a=pi.t.a; s.h.id=pi.t.id; s.v=e?1u:0u;
      if (DisplayConfigSetDeviceInfo(ref s)==0) any=true;
    }
    return any;
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp
switch ($Action) {
  'toggle' { [void][Hdr]::SetHdr(-not [Hdr]::CurrentEnabled()) }
  'on' { [void][Hdr]::SetHdr($true) }
  'off' { [void][Hdr]::SetHdr($false) }
}
[Hdr]::GetStateStr()
`

  const runHdr = async (action: 'status' | 'toggle' | 'on' | 'off'): Promise<{ supported: boolean; enabled: boolean }> => {
    const scriptPath = join(app.getPath('temp'), 'allaccess-hdr.ps1')
    try {
      writeFileSync(scriptPath, HDR_PS1, 'utf-8')
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, action],
        { windowsHide: true, timeout: 20_000 }
      )
      const m = /supported=(\d);enabled=(\d)/.exec(stdout.trim())
      return { supported: m?.[1] === '1', enabled: m?.[2] === '1' }
    } catch {
      return { supported: false, enabled: false }
    }
  }

  ipcMain.handle('hdr:status', () => runHdr('status'))
  ipcMain.handle('hdr:toggle', () => runHdr('toggle'))
  ipcMain.handle('hdr:on', () => runHdr('on'))
  ipcMain.handle('hdr:off', () => runHdr('off'))

  // Ouvre les VRAIS outils Windows pour la calibration fine (nits/noirs/couleurs non
  // pilotables par une appli tierce — c'est Windows/le moniteur qui les gère).
  ipcMain.handle('hdr:openSettings', () => {
    void shell.openExternal('ms-settings:display-advancedcolor')
    return { ok: true }
  })
  ipcMain.handle('hdr:openColorMgmt', async () => {
    try {
      await execFileAsync('colorcpl.exe', [], { windowsHide: true })
    } catch {
      /* panneau indisponible */
    }
    return { ok: true }
  })
  ipcMain.handle('hdr:openCalibration', async () => {
    // App « Windows HDR Calibration » si installée, sinon sa page Microsoft Store.
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-AppxPackage -Name Microsoft.WindowsHDRCalibration).PackageFamilyName'],
        { windowsHide: true }
      )
      const pfn = stdout.trim()
      if (pfn) {
        await execFileAsync('explorer.exe', [`shell:appsFolder\\${pfn}!App`], { windowsHide: true })
        return { ok: true, installed: true }
      }
    } catch {
      /* pas installée → Store */
    }
    void shell.openExternal('ms-windows-store://pdp/?ProductId=9N7F2SM5D1LR')
    return { ok: true, installed: false }
  })

  // Notification push Windows (toast natif) — utilisée par les pastilles de mise à jour.
  ipcMain.handle('app:notify', (_e, title: string, body: string) => {
    try {
      new Notification({ title, body }).show()
    } catch {
      /* notifications désactivées par l'OS */
    }
  })

  ipcMain.handle('perf:updateCheck', async () => {
    try {
      const src = join(perfSrcDir(), 'HwMonitor.exe')
      const dst = join(perfDstDir(), 'HwMonitor.exe')
      const installed = existsSync(dst)
      if (!installed || !existsSync(src)) return { installed, updateAvailable: false, embeddedHash: '' }
      const [srcHash, dstHash] = await Promise.all([hashFile(src), hashFile(dst)])
      // Les numéros de version accompagnent la pastille de mise à jour : sans eux, l'utilisateur
      // voit qu'« une » mise à jour existe sans savoir laquelle ni ce qu'elle change.
      const [embeddedVersion, installedVersion] = await Promise.all([exeVersion(src), exeVersion(dst)])
      return {
        installed,
        updateAvailable: srcHash !== dstHash,
        embeddedHash: srcHash,
        embeddedVersion,
        installedVersion,
        embeddedDate: statSync(src).mtime.toISOString(),
        installedDate: statSync(dst).mtime.toISOString()
      }
    } catch {
      return { installed: false, updateAvailable: false, embeddedHash: '' }
    }
  })

  ipcMain.handle('perf:install', async () => {
    try {
      const src = perfSrcDir()
      if (!existsSync(join(src, 'HwMonitor.exe'))) return { ok: false, error: 'Fichiers de l’overlay introuvables dans All Access.' }
      const dst = perfDstDir()
      mkdirSync(dst, { recursive: true })
      // L'overlay en cours d'exécution VERROUILLE son .exe → la copie échoue. On tente de le
      // fermer d'abord (best-effort : s'il a été lancé en admin, ce kill peut échouer, on le
      // signalera alors clairement plus bas). PresentMon (sous-processus FPS) est fermé aussi.
      try {
        await execFileAsync('taskkill', ['/F', '/IM', 'HwMonitor.exe', '/IM', 'PresentMon.exe'], { windowsHide: true })
        await new Promise((r) => setTimeout(r, 500))
      } catch {
        /* déjà fermé, ou droits insuffisants (overlay élevé) — la copie ci-dessous tranchera */
      }
      // PresentMon DOIT rester à côté de HwMonitor.exe (lancé en sous-processus pour les FPS)
      try {
        copyFileSync(join(src, 'HwMonitor.exe'), join(dst, 'HwMonitor.exe'))
        copyFileSync(join(src, 'PresentMon.exe'), join(dst, 'PresentMon.exe'))
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EBUSY' || code === 'EPERM')
          return {
            ok: false,
            error: "L'overlay est encore ouvert — ferme-le d'abord (passe la souris en haut à gauche de l'écran, puis clique la croix), et réessaie."
          }
        throw err
      }
      // Raccourci sur le bureau (SpecialFolders('Desktop') suit le bureau OneDrive le cas échéant).
      // On (re)définit explicitement l'icône vers l'exe à jour + on rafraîchit le cache d'icônes
      // Windows : ainsi l'icône du bureau reste correcte et à jour automatiquement à chaque MAJ.
      const exePath = join(dst, 'HwMonitor.exe').replace(/'/g, "''")
      await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut((Join-Path $ws.SpecialFolders('Desktop') 'HW Monitor.lnk')); $lnk.TargetPath = '${exePath}'; $lnk.WorkingDirectory = '${dst.replace(/'/g, "''")}'; $lnk.IconLocation = '${exePath},0'; $lnk.Description = 'Overlay performances (CPU/GPU/RAM/FPS)'; $lnk.Save(); try { ie4uinit.exe -show } catch {}`
      ])
      return { ok: true, installDir: dst }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('perf:launch', async () => {
    // Priorité à la copie installée ; sinon la copie embarquée fait l'affaire.
    const installed = join(perfDstDir(), 'HwMonitor.exe')

    // AUTO-MAJ de l'overlay au lancement : si la version embarquée dans All Access est plus
    // récente que la copie installée ET que l'overlay n'est pas déjà ouvert (fichier libre), on
    // la remplace AVANT de lancer. Plus besoin de « Réinstaller » ni de fermer l'overlay à la main.
    try {
      const src = join(perfSrcDir(), 'HwMonitor.exe')
      if (existsSync(src) && existsSync(installed) && statSync(src).mtimeMs > statSync(installed).mtimeMs) {
        copyFileSync(src, installed)
        const srcPm = join(perfSrcDir(), 'PresentMon.exe')
        if (existsSync(srcPm)) copyFileSync(srcPm, join(perfDstDir(), 'PresentMon.exe'))
      }
    } catch {
      /* overlay déjà ouvert (fichier verrouillé) → on lance la version en place, tant pis */
    }

    const exe = existsSync(installed) ? installed : join(perfSrcDir(), 'HwMonitor.exe')
    if (!existsSync(exe)) return { ok: false, error: `HwMonitor.exe introuvable : ${exe}` }
    // HwMonitor exige les droits admin (manifest requireAdministrator) : ShellExecute "open"
    // déclenche l'UAC automatiquement. child_process.spawn échouerait (ELEVATION_REQUIRED).
    const err = await shell.openPath(exe)
    if (err) return { ok: false, error: err }
    return { ok: true }
  })

  /* ----- test de la bannière de succès ----- */
  ipcMain.handle('debug:testAchievement', () => {
    const games = getGames()
    const sample = games[Math.floor(Math.random() * games.length)]
    achievementPoller.emitUnlock(
      sample ?? ({ id: 'test', name: 'All Access' } as never),
      {
        gameId: sample?.id ?? 'test',
        key: '__test__',
        name: 'Accès total',
        description: "Tu as testé la bannière de succès d'All Access",
        iconUrl: null,
        iconGrayUrl: null,
        unlocked: true,
        unlockTime: Date.now(),
        rarity: 4.2
      }
    )
  })

  /* ----- installation en arrière-plan (winget) ----- */
  installEvents.on('progress', (e: InstallProgressEvent) => {
    if (e.status === 'done') {
      const game = getGame(e.gameId)
      if (game) upsertGame({ ...game, installed: true })
      send('library:changed', null)
    }
    send('game:installProgress', e)
  })

  /* ----- événements temps réel vers le renderer ----- */
  processWatcher.on('game-started', (game) => send('game:session', { gameId: game.id, gameName: game.name, running: true }))
  processWatcher.on('game-stopped', (game) => send('game:session', { gameId: game.id, gameName: game.name, running: false }))
  achievementPoller.onUnlock((game, achievement) => {
    const fresh = getGame(game.id)
    send('achievement:unlocked', {
      gameId: game.id,
      gameName: game.name,
      achievement,
      unlockedCount: fresh?.achievementsUnlocked,
      totalCount: fresh?.achievementsTotal
    })
    // Filet de sécurité : notification Windows NATIVE en plus de la bannière overlay.
    // En plein écran exclusif, Windows n'affiche AUCUNE fenêtre par-dessus le jeu — la
    // bannière overlay se joue alors dans le vide. Le toast système, lui, est géré par
    // Windows (s'affiche par-dessus la plupart des jeux) et surtout RESTE dans le centre
    // de notifications : le déblocage laisse toujours une trace consultable après coup.
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: `🏆 Succès débloqué — ${game.name}`,
          body: achievement.name + (achievement.description ? `\n${achievement.description}` : ''),
          silent: true // le carillon est déjà joué par la fenêtre principale (réglage utilisateur)
        }).show()
      }
    } catch {
      /* notifications désactivées côté Windows — la bannière overlay reste le canal principal */
    }
  })
}
