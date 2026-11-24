import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { spawn } from 'child_process'
import { initDb } from './services/db'
import { getSettings } from './services/settings'
import { processWatcher } from './services/processWatcher'
import { achievementPoller } from './services/achievementPoller'
import { registerIpc } from './ipc'
import { initOverlay } from './overlay'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
// 'second-instance' peut se déclencher AVANT que whenReady() ait fini d'initialiser l'appli
// (ex. double-clic sur le raccourci Explorer qui relance l'exe une seconde fois pendant que la
// première instance démarre encore) — sans cette garde, ça créait une fenêtre prématurément,
// dont le montage React interrogeait l'IPC avant que registerIpc() ait eu le temps de s'exécuter :
// comptes « Non connecté », bibliothèque vide, version invisible, de façon irréversible pour cette
// fenêtre (un appel IPC échoué au montage ne se relance pas tout seul).
let appReady = false

// Indispensable pour que les toasts Windows portent le nom de l'app
app.setAppUserModelId('com.jdc.allaccess')

// Dossiers où déposer les nouvelles versions (« All Access Setup X.Y.Z.exe »). Le premier
// existant gagne. Ainsi une nouvelle version apparue ici s'installe seule au prochain lancement.
const UPDATE_DIRS = [join(app.getPath('home'), 'GameVault', 'release'), join(app.getPath('home'), 'AllAccessUpdates')]

/**
 * Auto-update LOCAL : au lancement (avant d'ouvrir la base → zéro risque), cherche un installeur
 * de version STRICTEMENT supérieure à l'actuelle. Si trouvé, le lance en silencieux et signale
 * qu'il faut quitter : l'installeur ferme l'appli, met à jour, puis la relance à jour.
 */
function checkLocalUpdate(): boolean {
  try {
    const flagFile = join(app.getPath('userData'), '.update-attempt')
    const cur = app.getVersion().split('.').map(Number)
    const gt = (v: number[]): boolean =>
      v[0] > cur[0] || (v[0] === cur[0] && (v[1] > cur[1] || (v[1] === cur[1] && v[2] > cur[2])))
    let best: string | null = null
    let bestDir = ''
    let bestV = [...cur]
    for (const dir of UPDATE_DIRS) {
      if (!existsSync(dir)) continue
      for (const f of readdirSync(dir)) {
        const m = f.match(/^All Access Setup (\d+)\.(\d+)\.(\d+)\.exe$/)
        if (!m) continue
        const v = [Number(m[1]), Number(m[2]), Number(m[3])]
        if (gt(v) && (v[0] > bestV[0] || v[1] > bestV[1] || v[2] > bestV[2])) {
          bestV = v
          best = f
          bestDir = dir
        }
      }
    }

    // Aucune MAJ : on nettoie le drapeau de tentative et on démarre normalement.
    if (!best) {
      try {
        if (existsSync(flagFile)) unlinkSync(flagFile)
      } catch {
        /* rien */
      }
      return false
    }

    // Garde-fou ANTI-BOUCLE : si on a déjà tenté CETTE version au démarrage précédent et qu'elle
    // n'est toujours pas installée (échec), on abandonne et on démarre l'appli actuelle — jamais
    // bloqué. Le drapeau est retiré pour permettre une nouvelle tentative plus tard.
    const target = bestV.join('.')
    try {
      if (existsSync(flagFile) && readFileSync(flagFile, 'utf-8').trim() === target) {
        unlinkSync(flagFile)
        return false
      }
      writeFileSync(flagFile, target)
    } catch {
      /* si on ne peut pas gérer le drapeau, on renonce à l'auto-update (sécurité) */
      return false
    }

    // Script détaché : attend la fermeture COMPLÈTE de l'appli, installe en silencieux, PUIS la
    // relance explicitement (ne dépend pas de runAfterFinish, ignoré en mode /S). C'est ce
    // relancement manquant qui laissait l'appli fermée sans pouvoir la rouvrir.
    const installer = join(bestDir, best).replace(/'/g, "''")
    const appExe = process.execPath.replace(/'/g, "''")
    const ps = [
      "$ErrorActionPreference='SilentlyContinue'",
      '$dl=(Get-Date).AddSeconds(20)',
      "while ((Get-Process 'All Access') -and (Get-Date) -lt $dl) { Start-Sleep -Milliseconds 300 }",
      `Start-Process -FilePath '${installer}' -ArgumentList '/S' -Wait`,
      `Start-Process -FilePath '${appExe}'`
    ].join('; ')
    spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], {
      detached: true,
      stdio: 'ignore'
    }).unref()
    return true
  } catch {
    /* dossier inaccessible / erreur — on démarre normalement, jamais bloqué */
  }
  return false
}

/**
 * Affiche la fenêtre principale de façon FIABLE, quel que soit son état :
 * - détruite/jamais créée → on la recrée ;
 * - minimisée → restore() (show() seul ne suffit pas) ;
 * - cachée dans le tray → show() + focus() ;
 * - un jeu au premier plan refuse le focus → passage éclair en always-on-top pour
 *   percer au-dessus (fonctionne en fenêtré/borderless), et clignotement dans la
 *   barre des tâches pour qu'il y ait TOUJOURS un signe de vie visible.
 * NB : en plein écran EXCLUSIF, Windows n'affiche rien par-dessus le jeu — le
 * clignotement de la barre des tâches reste alors le seul signal possible.
 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  mainWindow.setAlwaysOnTop(true)
  mainWindow.setAlwaysOnTop(false)
  if (!mainWindow.isFocused()) {
    mainWindow.flashFrame(true)
    mainWindow.once('focus', () => mainWindow?.flashFrame(false))
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Relance via le raccourci alors que l'appli tourne déjà (résidente) :
  // on doit répondre par un signe visible, jamais par un silence.
  // Si l'appli est encore en train de démarrer (voir `appReady` ci-dessus), on ignore
  // l'événement : la fenêtre en cours de création s'affichera d'elle-même dans un instant.
  app.on('second-instance', () => {
    if (appReady) showMainWindow()
  })

  app.whenReady().then(() => {
    // Indispensable en premier : si une étape plus bas (tray, overlay, autostart…) échoue pour
    // une raison propre à la machine (ex. tray parfois muet quand l'appli est lancée via un
    // raccourci Explorer), l'appli ne doit JAMAIS se retrouver sans échanges avec l'interface —
    // ça s'est produit : comptes affichés « Non connecté », bibliothèque vide, version invisible.
    // Auto-update local D'ABORD : si une version plus récente est dispo, on l'installe et on quitte
    // avant même d'ouvrir la base (aucun risque de corruption). L'installeur relance l'appli à jour.
    if (checkLocalUpdate()) {
      app.quit()
      return
    }
    initDb()
    createWindow()
    registerIpc(() => mainWindow)
    appReady = true

    // Tout ce qui suit est secondaire (icône tray, overlay de succès, autostart, surveillance des
    // process) : chaque étape est isolée pour qu'un échec ponctuel n'entraîne pas les suivantes.
    try {
      createTray()
    } catch (e) {
      console.error('[startup] icône système indisponible, on continue sans :', e)
    }
    try {
      initOverlay()
    } catch (e) {
      console.error('[startup] overlay de succès indisponible :', e)
    }

    try {
      processWatcher.start()
      achievementPoller.start()
      // Quand un jeu démarre, l'app se manifeste discrètement (fenêtre si elle était visible, sinon tray + toast du poller)
      processWatcher.on('game-started', () => {
        if (mainWindow?.isVisible()) mainWindow.webContents.send('focus-session', null)
      })
    } catch (e) {
      console.error('[startup] surveillance des jeux indisponible :', e)
    }

    // Autostart Windows (démarre caché dans le tray)
    try {
      const s = getSettings()
      if (app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: s.autostart, args: ['--hidden'] })
      }
    } catch (e) {
      console.error('[startup] réglage du démarrage automatique indisponible :', e)
    }
  })

  app.on('before-quit', () => {
    quitting = true
    processWatcher.stop()
    achievementPoller.stop()
  })

  app.on('window-all-closed', () => {
    /* app résidente : ne jamais quitter à la fermeture de fenêtre */
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: !process.argv.includes('--hidden'),
    frame: false,
    backgroundColor: '#0a0a12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // le carillon de succès est joué depuis cette fenêtre (WebAudio) — elle est souvent masquée
      // dans le tray pendant qu'on joue : on empêche le throttling en arrière-plan et on autorise
      // la lecture audio sans geste utilisateur préalable, sinon le son serait bloqué/étouffé.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  if (!app.isPackaged) {
    // dev : remonte la console du renderer dans le terminal
    mainWindow.webContents.on('did-fail-load', (_e, code, desc) => console.error('[renderer] did-fail-load', code, desc))
    mainWindow.webContents.on('render-process-gone', (_e, details) => console.error('[renderer] gone', details.reason))
  }

  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('All Access')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir All Access', click: () => showMainWindow() },
      { label: 'Synchroniser', click: () => mainWindow?.webContents.send('tray:sync', null) },
      { type: 'separator' },
      {
        label: 'Quitter',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
  // clic simple ET double-clic : personne ne devine qu'il faut double-cliquer
  tray.on('click', () => showMainWindow())
  tray.on('double-click', () => showMainWindow())
}
