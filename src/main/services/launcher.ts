import { app, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import { dirname, join } from 'path'
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs'
import type { AppItem, Game, InstallProgressEvent } from '../../shared/types'
import { getAuth } from './authStore'
import { scanInstalledXboxStoreIds } from './xboxDownload'

const execFileAsync = promisify(execFile)

/** Émet les événements de progression d'installation (relayés vers le renderer par ipc.ts). */
export const installEvents = new EventEmitter()

let startAppsCache: { name: string; appId: string }[] | null = null
let startAppsInFlight: Promise<{ name: string; appId: string }[]> | null = null

function normalize(s: string): string {
  return s.toLowerCase().replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, '')
}

/** AUMID des applications du menu Démarrer (jeux Xbox/Store inclus), via Get-StartApps. */
async function getStartApps(): Promise<{ name: string; appId: string }[]> {
  if (startAppsCache) return startAppsCache
  // évite de lancer plusieurs fois le même PowerShell en parallèle si plusieurs appels
  // arrivent avant que le premier n'ait eu le temps de remplir le cache
  if (startAppsInFlight) return startAppsInFlight
  startAppsInFlight = (async () => {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-StartApps | ConvertTo-Json -Compress'
      ])
      const arr = JSON.parse(stdout) as { Name: string; AppID: string }[]
      startAppsCache = arr.map((a) => ({ name: a.Name, appId: a.AppID }))
    } catch {
      startAppsCache = []
    }
    startAppsInFlight = null
    return startAppsCache
  })()
  return startAppsInFlight
}

export function invalidateStartAppsCache(): void {
  startAppsCache = null
}

/**
 * Ouvre directement l'appli Xbox (native, jamais un navigateur) plutôt que de compter sur le
 * protocole `ms-windows-store://` — ce dernier retombe sur une recherche web quand il n'est pas
 * correctement associé à une appli sur la machine (Gaming Services/Store cassés).
 */
export async function openXboxApp(): Promise<boolean> {
  const apps = await getStartApps()
  // "Xbox" exact d'abord (le vrai hub Game Pass) — sinon on évite les paquets satellites
  // (Xbox Game Bar, Xbox Live Callable UI, Xbox Accessories…) qui matcheraient /xbox/i à tort.
  const match =
    apps.find((a) => normalize(a.name) === 'xbox' && a.appId.includes('!')) ??
    apps.find((a) => /^xbox game$|^xbox console companion$/i.test(a.name.trim()) && a.appId.includes('!'))
  if (!match) return false
  await execFileAsync('explorer.exe', [`shell:AppsFolder\\${match.appId}`]).catch(() => {
    /* explorer renvoie un code de sortie non nul même en cas de succès */
  })
  return true
}

let wingetAvailable: boolean | null = null

async function hasWinget(): Promise<boolean> {
  if (wingetAvailable !== null) return wingetAvailable
  try {
    await execFileAsync('winget', ['--version'])
    wingetAvailable = true
  } catch {
    wingetAvailable = false
  }
  return wingetAvailable
}

const wingetCatalogCache = new Map<string, boolean>()

/** Le catalogue winget "msstore" n'indexe pas tous les jeux (les gros AAA en sont souvent absents). */
async function isInWingetCatalog(productId: string): Promise<boolean> {
  if (wingetCatalogCache.has(productId)) return wingetCatalogCache.get(productId)!
  try {
    await execFileAsync('winget', [
      'show',
      '--id',
      productId,
      '--source',
      'msstore',
      '--accept-source-agreements'
    ])
    wingetCatalogCache.set(productId, true)
    return true
  } catch {
    wingetCatalogCache.set(productId, false)
    return false
  }
}

/**
 * Installe un jeu du Microsoft Store en arrière-plan via winget — équivalent du
 * `steam://install/` de Steam : pas besoin de cliquer sur "Installer" dans le Store.
 * Émet des événements de progression sur `installEvents` ('progress').
 * Retourne false si winget est indisponible ou si le jeu n'est pas dans son catalogue
 * (fréquent pour les gros jeux AAA) — l'appelant se rabat alors sur la fiche Store.
 */
async function installViaWinget(game: Game): Promise<boolean> {
  if (!game.storeProductId || !(await hasWinget())) return false
  if (!(await isInWingetCatalog(game.storeProductId))) return false

  const emit = (e: Omit<InstallProgressEvent, 'gameId' | 'gameName'>): void => {
    installEvents.emit('progress', { gameId: game.id, gameName: game.name, ...e } satisfies InstallProgressEvent)
  }

  emit({ status: 'started' })
  execFile(
    'winget',
    [
      'install',
      '--id',
      game.storeProductId,
      '--source',
      'msstore',
      '--accept-package-agreements',
      '--accept-source-agreements'
    ],
    { timeout: 45 * 60_000 },
    (err, stdout, stderr) => {
      if (err) {
        emit({ status: 'error', message: stderr?.trim() || err.message })
        return
      }
      invalidateStartAppsCache()
      emit({ status: 'done', message: stdout?.trim() })
    }
  )
  return true
}

export async function launchGame(game: Game): Promise<{ ok: boolean; error?: string }> {
  if (game.platform === 'steam') {
    // installé → lance directement ; sinon → Steam ouvre l'écran d'installation du jeu
    const uri = game.installed ? 'rungameid' : 'install'
    await shell.openExternal(`steam://${uri}/${game.externalId}`)
    return { ok: true }
  }
  if (game.platform === 'rockstar' || game.platform === 'ubisoft') {
    if (game.platform === 'ubisoft') {
      // launcher officiel Ubisoft Connect : lance (ou installe) via son URI
      await shell.openExternal(`uplay://launch/${game.externalId}/0`)
      return { ok: true }
    }
    // Rockstar : toujours détecté déjà installé (pas d'API de compte) — on lance l'exe directement
    if (!game.installDir || game.exeHints.length === 0) {
      return { ok: false, error: 'Exécutable introuvable pour ce jeu Rockstar.' }
    }
    const exePath = join(game.installDir, game.exeHints[0])
    // spawn détaché : ne pas attendre la fermeture du jeu pour répondre à l'IPC
    spawn(exePath, [], { cwd: dirname(exePath), detached: true, stdio: 'ignore' }).unref()
    return { ok: true }
  }
  if (game.platform === 'epic') {
    // storeProductId = "namespace:catalogItemId:appName" ; externalId = appName
    if (game.installed) {
      await shell.openExternal(`com.epicgames.launcher://apps/${game.externalId}?action=launch&silent=true`)
    } else {
      const triple = game.storeProductId ?? `::${game.externalId}`
      await shell.openExternal(`com.epicgames.launcher://apps/${encodeURIComponent(triple)}?action=install`)
    }
    return { ok: true }
  }
  // Xbox : retrouve l'AUMID par nom dans le menu Démarrer
  const apps = await getStartApps()
  const target = normalize(game.name)
  const match =
    apps.find((a) => normalize(a.name) === target) ??
    apps.find((a) => normalize(a.name).includes(target) || target.includes(normalize(a.name)))
  if (match && match.appId.includes('!')) {
    await execFileAsync('explorer.exe', [`shell:AppsFolder\\${match.appId}`]).catch(() => {
      /* explorer renvoie un code de sortie non nul même en cas de succès */
    })
    return { ok: true }
  }
  // Pas installé : installation directe en arrière-plan via winget quand le jeu y est catalogué
  if (await installViaWinget(game)) return { ok: true }
  // Sinon (fréquent pour les gros jeux AAA) : priorité à l'appli Xbox native — jamais le navigateur.
  if (await openXboxApp()) return { ok: true }
  if (game.storeProductId) {
    await shell.openExternal(`ms-windows-store://pdp/?productid=${game.storeProductId}`)
    return { ok: true }
  }
  await shell.openExternal(`ms-windows-store://search/?query=${encodeURIComponent(game.name)}`)
  return { ok: true }
}

/** Marque installés les jeux Xbox présents dans le menu Démarrer. */
export async function detectInstalledXboxGames(games: Game[]): Promise<Set<string>> {
  const apps = await getStartApps()
  const appNames = apps.map((a) => normalize(a.name))
  // Match FIABLE par StoreId : dossiers XboxGames\<jeu>\Content\MicrosoftGame.Config sur disque.
  // Insensible aux différences de nom (« Remnant II® - Standard Edition » vs « Remnant2 »).
  const installedStoreIds = scanInstalledXboxStoreIds()
  const installed = new Set<string>()
  for (const g of games) {
    if (g.platform !== 'xbox') continue
    // 1) StoreId présent parmi les jeux installés sur disque → fiable, on s'arrête là.
    if (g.storeProductId && installedStoreIds.has(g.storeProductId.toUpperCase())) {
      installed.add(g.id)
      continue
    }
    // 2) Repli : nom exact normalisé présent au menu Démarrer (jeux hors XboxGames / UWP purs).
    const n = normalize(g.name)
    if (appNames.some((an) => an === n)) installed.add(g.id)
  }
  return installed
}

/** Marque installées les applications présentes dans le menu Démarrer (par nom). */
export async function detectInstalledApps(names: string[]): Promise<Set<string>> {
  const apps = await getStartApps()
  const appNames = apps.map((a) => normalize(a.name))
  return new Set(names.filter((n) => appNames.includes(normalize(n))))
}

/** Lance une app installée, ou déclenche son installation (winget si dispo, sinon fiche Store). */
export async function launchOrInstallApp(app: AppItem): Promise<{ ok: boolean; error?: string }> {
  if (app.platform === 'steam') {
    const uri = app.installed ? 'rungameid' : 'install'
    await shell.openExternal(`steam://${uri}/${app.productId}`)
    return { ok: true }
  }
  const apps = await getStartApps()
  const target = normalize(app.name)
  const match =
    apps.find((a) => normalize(a.name) === target) ??
    apps.find((a) => normalize(a.name).includes(target) || target.includes(normalize(a.name)))
  if (match && match.appId.includes('!')) {
    await execFileAsync('explorer.exe', [`shell:AppsFolder\\${match.appId}`]).catch(() => {
      /* explorer renvoie un code de sortie non nul même en cas de succès */
    })
    return { ok: true }
  }
  const asGame: Game = {
    id: app.id,
    platform: 'xbox',
    externalId: app.productId,
    name: app.name,
    ownership: 'owned',
    ownershipOverride: null,
    hidden: false,
    installed: false,
    installDir: null,
    exeHints: [],
    devices: [],
    playtimeMinutes: 0,
    lastPlayed: null,
    coverUrl: app.coverUrl,
    heroUrl: app.coverUrl,
    storeProductId: app.productId,
    achievementsTotal: 0,
    achievementsUnlocked: 0,
    dlcOwned: 0,
    dlcTotal: 0,
    updatedAt: Date.now()
  }
  if (await installViaWinget(asGame)) return { ok: true }
  if (await openXboxApp()) return { ok: true }
  await shell.openExternal(`ms-windows-store://pdp/?productid=${app.productId}`)
  return { ok: true }
}

/** Résout le paquet MSIX installé (Xbox/Store) correspondant à un jeu, via Get-StartApps puis Get-AppxPackage. */
async function findAppxPackage(game: Game): Promise<{ familyName: string; fullName: string } | null> {
  const apps = await getStartApps()
  const target = normalize(game.name)
  const match =
    apps.find((a) => normalize(a.name) === target) ??
    apps.find((a) => normalize(a.name).includes(target) || target.includes(normalize(a.name)))
  if (!match || !match.appId.includes('!')) return null
  const familyName = match.appId.split('!')[0]
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq '${familyName.replace(/'/g, "''")}' } | Select-Object -First 1 -ExpandProperty PackageFullName`
    ])
    const fullName = stdout.trim()
    return fullName ? { familyName, fullName } : null
  } catch {
    return null
  }
}

/** Sauvegarde locale (best-effort) des dossiers de sauvegarde d'un paquet Xbox avant désinstallation. */
function backupXboxSaveData(familyName: string, gameId: string): void {
  const base = join(process.env.LOCALAPPDATA ?? '', 'Packages', familyName)
  const backupRoot = join(
    app.getPath('userData'),
    'SaveBackups',
    gameId.replace(/[^a-z0-9:_-]/gi, '_'),
    String(Date.now())
  )
  for (const sub of ['LocalState', 'SystemAppData\\wgs']) {
    const src = join(base, sub)
    if (!existsSync(src)) continue
    try {
      const dest = join(backupRoot, sub)
      mkdirSync(dest, { recursive: true })
      cpSync(src, dest, { recursive: true })
    } catch {
      /* best-effort — on ne bloque jamais la désinstallation pour ça */
    }
  }
}

/** Cherche le désinstalleur Windows officiel (registre) dont l'InstallLocation correspond à ce dossier. */
async function findWin32Uninstaller(installDir: string): Promise<string | null> {
  const roots = [
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
  ]
  const normDir = installDir.toLowerCase().replace(/[\\/]+$/, '')
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-ItemProperty ${roots.join(',')} -ErrorAction SilentlyContinue | Select-Object InstallLocation, UninstallString | ConvertTo-Json -Compress`
    ])
    const parsed = stdout.trim() ? (JSON.parse(stdout) as unknown) : null
    const entries = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : []) as {
      InstallLocation?: string
      UninstallString?: string
    }[]
    const hit = entries.find(
      (e) => e.InstallLocation && e.UninstallString && e.InstallLocation.toLowerCase().replace(/[\\/]+$/, '') === normDir
    )
    return hit?.UninstallString ?? null
  } catch {
    return null
  }
}

/**
 * Désinstalle intégralement un jeu de ce PC. `deleteSave` contrôle le sort de la sauvegarde locale :
 * - Steam : la sauvegarde Steam Cloud reste gérée par Steam lui-même (fenêtre native ouverte) ;
 *   si `deleteSave`, on purge en plus le cache local `userdata/<compte>/<appid>` sur ce PC.
 * - Xbox : Windows supprime toujours les données locales du paquet à la désinstallation — si
 *   `!deleteSave`, on en fait d'abord une copie locale dans le dossier de données d'All Access.
 * - Rockstar/Ubisoft/Epic : délègue au désinstalleur Windows officiel du jeu (registre) — c'est
 *   cet outil qui décide, le cas échéant, de préserver ou non la sauvegarde.
 */
export async function uninstallGame(
  game: Game,
  deleteSave: boolean
): Promise<{ ok: boolean; error?: string; message?: string }> {
  if (game.platform === 'steam') {
    if (deleteSave) {
      const steamId64 = getAuth().steam?.steamId64
      if (steamId64) {
        try {
          const accountId = (BigInt(steamId64) - 76561197960265728n).toString()
          const { stdout } = await execFileAsync('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "(Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath"
          ])
          const steamPath = stdout.trim().replace(/\//g, '\\')
          if (steamPath) {
            const dir = join(steamPath, 'userdata', accountId, game.externalId)
            if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
          }
        } catch {
          /* best-effort — la sauvegarde cloud Steam reste de toute façon gérée par Steam lui-même */
        }
      }
    }
    await shell.openExternal(`steam://uninstall/${game.externalId}`)
    return { ok: true, message: 'Confirme la désinstallation dans la fenêtre Steam qui vient de s’ouvrir.' }
  }

  if (game.platform === 'xbox') {
    const pkg = await findAppxPackage(game)
    if (!pkg) return { ok: false, error: "Paquet Xbox introuvable — le jeu n'est peut-être déjà plus installé." }
    if (!deleteSave) backupXboxSaveData(pkg.familyName, game.id)
    try {
      await execFileAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Remove-AppxPackage -Package '${pkg.fullName.replace(/'/g, "''")}'`
      ])
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
    invalidateStartAppsCache()
    return {
      ok: true,
      message: deleteSave
        ? 'Jeu et sauvegarde locale supprimés.'
        : 'Jeu désinstallé — une copie de la sauvegarde locale a été conservée par All Access.'
    }
  }

  // Rockstar / Ubisoft / Epic : pas d'API de désinstallation fiable, on s'appuie sur le
  // désinstalleur Windows officiel du jeu (registre) — ces launchers y enregistrent leurs jeux.
  if (!game.installDir) return { ok: false, error: "Dossier d'installation inconnu pour ce jeu." }
  const uninstallCmd = await findWin32Uninstaller(game.installDir)
  if (!uninstallCmd) {
    return {
      ok: false,
      error:
        "Désinstalleur introuvable — désinstalle ce jeu depuis son launcher officiel (Ubisoft Connect ou Rockstar Games Launcher)."
    }
  }
  spawn(uninstallCmd, [], { shell: true, detached: true, stdio: 'ignore' }).unref()
  return {
    ok: true,
    message: "L'assistant de désinstallation officiel s'est ouvert — la sauvegarde dépend du choix qu'il te proposera."
  }
}
