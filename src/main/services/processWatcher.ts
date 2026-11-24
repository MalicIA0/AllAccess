import { EventEmitter } from 'events'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getGames, startSession, endSession } from './db'
import type { Game } from '../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * Détection des jeux en cours :
 *  - Steam : registre HKCU\Software\Valve\Steam → RunningAppID (fiable, instantané)
 *  - Autres : tasklist toutes les 10 s, croisé avec les exe hints connus
 */

export interface RunningGame {
  game: Game
  sessionId: number
}

class ProcessWatcher extends EventEmitter {
  private running = new Map<string, RunningGame>() // gameId → session
  private steamTimer: NodeJS.Timeout | null = null
  private taskTimer: NodeJS.Timeout | null = null
  private lastSteamAppId = '0'

  start(): void {
    this.steamTimer = setInterval(() => void this.pollSteamRegistry(), 5_000)
    this.taskTimer = setInterval(() => void this.pollTasklist(), 10_000)
  }

  stop(): void {
    if (this.steamTimer) clearInterval(this.steamTimer)
    if (this.taskTimer) clearInterval(this.taskTimer)
  }

  getRunning(): RunningGame[] {
    return [...this.running.values()]
  }

  private markStarted(game: Game): void {
    if (this.running.has(game.id)) return
    const sessionId = startSession(game.id)
    this.running.set(game.id, { game, sessionId })
    this.emit('game-started', game)
  }

  private markStopped(gameId: string): void {
    const rg = this.running.get(gameId)
    if (!rg) return
    endSession(rg.sessionId)
    this.running.delete(gameId)
    this.emit('game-stopped', rg.game)
  }

  private async pollSteamRegistry(): Promise<void> {
    try {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKCU\\Software\\Valve\\Steam',
        '/v',
        'RunningAppID'
      ])
      const appId = stdout.match(/RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i)?.[1]
      const current = appId ? String(parseInt(appId, 16)) : '0'
      if (current === this.lastSteamAppId) return
      // Un jeu Steam s'est arrêté
      if (this.lastSteamAppId !== '0') this.markStopped(`steam:${this.lastSteamAppId}`)
      // Un jeu Steam a démarré
      if (current !== '0') {
        const game = getGames().find((g) => g.id === `steam:${current}`)
        if (game) this.markStarted(game)
      }
      this.lastSteamAppId = current
    } catch {
      /* registre indisponible */
    }
  }

  private async pollTasklist(): Promise<void> {
    // Ne surveille par tasklist que les jeux avec exe hints (installés hors Steam ou fallback)
    const candidates = getGames().filter((g) => g.exeHints.length > 0)
    if (candidates.length === 0) return
    try {
      const { stdout } = await execFileAsync('tasklist', ['/fo', 'csv', '/nh'], { maxBuffer: 8 * 1024 * 1024 })
      const processes = new Set(
        stdout
          .split('\n')
          .map((l) => l.split('","')[0]?.replace(/^"/, '').toLowerCase().trim())
          .filter(Boolean)
      )
      for (const game of candidates) {
        const isRunning = game.exeHints.some((exe) => processes.has(exe))
        const tracked = this.running.has(game.id)
        // Steam est déjà géré par le registre — tasklist sert de complément uniquement
        if (isRunning && !tracked) this.markStarted(game)
        else if (!isRunning && tracked && game.platform !== 'steam') this.markStopped(game.id)
      }
    } catch {
      /* tasklist indisponible */
    }
  }
}

export const processWatcher = new ProcessWatcher()
