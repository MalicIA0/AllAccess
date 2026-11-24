import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { AppSettings } from '../../shared/types'

/** Préférences non sensibles. Les jetons de session vivent dans authStore (chiffrés). */

const DEFAULTS: AppSettings = {
  autostart: true,
  autoSyncOnLaunch: true,
  pollAchievementsSec: 60,
  pollFriendsMin: 15,
  theme: 'nebula',
  notifSound: true,
  chimeVolume: 60,
  chimeStyle: 'cristal',
  notifStyle: 'banniere',
  notifDurationSec: 10,
  bgMode: 'halos-particules',
  bgSpeed: 1,
  cardSize: 'normal'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  if (!existsSync(settingsPath())) {
    cache = { ...DEFAULTS }
    return cache
  }
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(readFileSync(settingsPath(), 'utf-8')) as Partial<AppSettings>) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

export function saveSettings(s: AppSettings): void {
  // Le cache reflète le dernier état voulu même si l'écriture disque échoue.
  cache = { ...s }
  try {
    const p = settingsPath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(s, null, 2), 'utf-8')
  } catch (e) {
    console.error('[settings] échec de la sauvegarde:', e)
  }
}
