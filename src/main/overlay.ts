import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { achievementPoller } from './services/achievementPoller'
import { getSettings } from './services/settings'
import type { NotifStyle } from '../shared/types'

/**
 * Overlay de succès : fenêtre transparente, toujours au-dessus (même au-dessus
 * d'un jeu en borderless/fenêtré), transparente aux clics. Sa taille et sa position
 * s'adaptent au style de notification choisi (bannière bas-centre, toast haut-droit,
 * cinéma centré). La page overlay gère sa file d'attente et signale quand elle a fini.
 */

// dimensions de la fenêtre selon le style (assez grandes pour l'onde de choc + particules).
// `plein` = plein écran : dimensions résolues dynamiquement dans position() (workArea complète).
const BOUNDS: Record<NotifStyle, { w: number; h: number }> = {
  banniere: { w: 700, h: 240 },
  toast: { w: 470, h: 200 },
  cinema: { w: 560, h: 460 },
  plein: { w: 0, h: 0 }, // remplacé par la taille de l'écran dans position()
  sticker: { w: 0, h: 360 }, // largeur = tout l'écran (résolue dans position()) : l'autocollant glisse depuis le bord droit ; hauteur = place pour l'anneau de choc
  feuartifice: { w: 820, h: 400 }, // large pour laisser éclater les gerbes autour
  neon: { w: 720, h: 260 }
}

let overlay: BrowserWindow | null = null

export function initOverlay(): void {
  overlay = new BrowserWindow({
    width: BOUNDS.banniere.w,
    height: BOUNDS.banniere.h,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setIgnoreMouseEvents(true)
  position()

  if (process.env.ELECTRON_RENDERER_URL) {
    void overlay.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`)
  } else {
    void overlay.loadFile(join(__dirname, '../renderer/overlay.html'))
  }

  // la page overlay a vidé sa file d'attente → on masque la fenêtre
  ipcMain.on('overlay:idle', () => {
    stopKeepOnTop()
    overlay?.hide()
  })

  // un succès tombe → on s'assure que l'overlay est visible ET au premier plan (la page reçoit
  // le même événement 'achievement:unlocked' broadcasté par l'IPC). On force show + toujours-au-
  // dessus + moveTop à CHAQUE fois : sinon, une fenêtre restée « visible » mais passée derrière
  // le jeu/l'appli n'était jamais ramenée → la bannière se jouait dans le vide (invisible).
  achievementPoller.onUnlock(() => {
    if (!overlay || overlay.isDestroyed()) return
    position()
    overlay.showInactive()
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.moveTop()
    // ...puis on REAFFIRME le premier plan en continu tant que la bannière est à l'écran.
    // Un moveTop() unique ne suffit pas : beaucoup de jeux (Halo, etc.) replacent leur propre
    // fenêtre au-dessus juste après, et la bannière jouait alors ses 10 s cachée DERRIERE le jeu
    // — succès détecté, jamais vu. C'est la technique qu'utilise déjà l'overlay HW Monitor
    // (SetWindowPos HWND_TOPMOST à chaque tick), et c'est pour ça que lui reste visible en jeu.
    startKeepOnTop()
  })
}

let topTicker: NodeJS.Timeout | null = null

function stopKeepOnTop(): void {
  if (topTicker) clearInterval(topTicker)
  topTicker = null
}

/** Replace l'overlay au premier plan ~2x/s, avec un garde-fou de durée si `overlay:idle` se perd. */
function startKeepOnTop(): void {
  stopKeepOnTop()
  // garde-fou : durée choisie par l'utilisateur + marge d'animation, borné pour ne jamais tourner
  // indéfiniment si la page overlay ne renvoie pas son signal d'inactivité.
  const durationSec = getSettings().notifDurationSec ?? 10
  const until = Date.now() + Math.min(Math.max(durationSec, 3), 30) * 1000 + 5000
  topTicker = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible() || Date.now() > until) {
      stopKeepOnTop()
      return
    }
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.moveTop()
  }, 450)
}

function position(): void {
  if (!overlay) return
  const style: NotifStyle = getSettings().notifStyle ?? 'banniere'
  const { workArea } = screen.getPrimaryDisplay()

  // Plein écran : la fenêtre couvre tout l'espace de travail (fond assombri + carte centrale)
  if (style === 'plein') {
    overlay.setBounds({ x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height })
    return
  }

  // Sticker : bande pleine largeur au milieu de l'écran. La fenêtre doit couvrir toute la largeur
  // pour que l'autocollant puisse arriver de HORS écran à droite et glisser jusqu'au centre —
  // dans une fenêtre de 640 px il n'y avait aucune place pour le déplacement (il était rogné).
  if (style === 'sticker') {
    const sh = BOUNDS.sticker.h
    overlay.setBounds({
      x: workArea.x,
      y: workArea.y + Math.round((workArea.height - sh) / 2),
      width: workArea.width,
      height: sh
    })
    return
  }

  const { w, h } = BOUNDS[style] ?? BOUNDS.banniere
  const centerX = Math.round(workArea.x + (workArea.width - w) / 2)
  let x = centerX
  let y = workArea.y + workArea.height - h - 14 // bas de l'écran par défaut (bannière)
  if (style === 'toast') {
    x = workArea.x + workArea.width - w - 18 // coin haut-droit
    y = workArea.y + 18
  } else if (style === 'cinema') {
    y = workArea.y + Math.round(workArea.height * 0.16) // tiers supérieur, centré
  }
  // feuartifice / neon : bas-centre (comme la bannière), l'effet fait la différence
  overlay.setBounds({ x, y, width: w, height: h })
}

export function destroyOverlay(): void {
  overlay?.destroy()
  overlay = null
}
