import type { Achievement, Game } from '../../shared/types'
import { getSettings } from './settings'
import { isXboxConnected } from './xboxAuth'
import { syncSteamAchievements } from './steam'
import { syncXboxAchievements } from './xbox'
import { getGames } from './db'
import { processWatcher } from './processWatcher'
import { alog } from './achievementLog'

type UnlockListener = (game: Game, achievement: Achievement) => void

/** Seules Steam et Xbox exposent une API de succès — Rockstar/Epic/Ubisoft n'en ont pas. */
function hasAchievementSync(game: Game): boolean {
  return game.platform === 'steam' || game.platform === 'xbox'
}

/**
 * Pendant qu'un jeu tourne : poll de ses succès toutes les N secondes (défaut 60).
 * En arrière-plan : sweep des titres Xbox récents toutes les 15 min.
 * Les déblocages sont diffusés aux listeners (overlay animé + UI).
 */
class AchievementPoller {
  private timers = new Map<string, NodeJS.Timeout>()
  private sweepTimer: NodeJS.Timeout | null = null
  private fastTimer: NodeJS.Timeout | null = null
  private fastBusy = false
  private activeXboxId: string | null = null
  private listeners: UnlockListener[] = []

  onUnlock(fn: UnlockListener): void {
    this.listeners.push(fn)
  }

  /** Diffuse un déblocage (aussi utilisé par le bouton « Tester » des Réglages). */
  emitUnlock(game: Game, achievement: Achievement): void {
    for (const fn of this.listeners) fn(game, achievement)
  }

  start(): void {
    alog('=== poller de succes demarre (session All Access) ===')
    processWatcher.on('game-started', (game: Game) => {
      if (hasAchievementSync(game)) this.watchGame(game)
    })
    processWatcher.on('game-stopped', (game: Game) => {
      // Dernier poll 5 s après la fermeture (les succès de fin de session)
      if (hasAchievementSync(game)) setTimeout(() => void this.pollOnce(game), 5_000)
      this.unwatchGame(game.id)
    })
    // Xbox : les jeux UWP/Game Pass ne sont PAS détectés comme « en cours » par le processWatcher
    // (pas d'exe classique surveillable) → le poll rapide en jeu ne démarre jamais pour eux. Ce
    // balayage des jeux Xbox récemment joués est donc leur SEULE source de bannières de succès :
    // on le fait tourner toutes les 2 min (au lieu de 15) pour que le pop-up arrive vite après le
    // déblocage. Charge réseau négligeable (≤10 appels achievements.xboxlive.com par cycle).
    this.sweepTimer = setInterval(() => void this.sweepXboxRecent(), 2 * 60_000)
    // Sweep initial 15 s après le démarrage
    setTimeout(() => void this.sweepXboxRecent(), 15_000)
    // Poll RAPIDE (10 s) du seul jeu Xbox auquel on joue (le plus récemment joué) : les jeux
    // Game Pass/UWP ne sont pas vus par le processWatcher, donc sans ça un succès Xbox pouvait
    // mettre jusqu'à 2 min (cycle du sweep) à s'afficher. Ici la bannière tombe quasi tout de
    // suite après que Xbox Live expose le déblocage. Un seul jeu ciblé = charge réseau minime.
    this.fastTimer = setInterval(() => void this.pollActiveXbox(), 10_000)
  }

  stop(): void {
    for (const t of this.timers.values()) clearInterval(t)
    this.timers.clear()
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.fastTimer) clearInterval(this.fastTimer)
  }

  /** Poll ciblé et fréquent du jeu Xbox actif présumé (le plus récemment joué, < 12 h). */
  private async pollActiveXbox(): Promise<void> {
    if (this.fastBusy || !isXboxConnected().connected) return
    const active = getGames()
      .filter((g) => g.platform === 'xbox' && (g.lastPlayed ?? 0) > Date.now() - 12 * 3600_000)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))[0]
    this.activeXboxId = active?.id ?? null
    if (!active) return
    this.fastBusy = true
    try {
      await this.pollOnce(active)
    } finally {
      this.fastBusy = false
    }
  }

  private watchGame(game: Game): void {
    if (this.timers.has(game.id)) return
    const interval = Math.max(30, getSettings().pollAchievementsSec) * 1000
    alog(`jeu detecte -> surveillance active : ${game.name} (${game.id}), poll toutes les ${interval / 1000}s`)
    // Premier poll rapide pour initialiser l'état
    setTimeout(() => void this.pollOnce(game), 10_000)
    this.timers.set(
      game.id,
      setInterval(() => void this.pollOnce(game), interval)
    )
  }

  private unwatchGame(gameId: string): void {
    const t = this.timers.get(gameId)
    if (t) clearInterval(t)
    this.timers.delete(gameId)
  }

  private async pollOnce(game: Game): Promise<void> {
    if (!hasAchievementSync(game)) return
    try {
      const newlyUnlocked =
        game.platform === 'steam'
          ? await syncSteamAchievements(game.externalId)
          : await syncXboxAchievements(game.externalId)
      if (newlyUnlocked.length > 0)
        alog(`DEBLOCAGE x${newlyUnlocked.length} : ${game.name} -> ${newlyUnlocked.map((a) => a.name).join(' | ')}`)
      for (const a of newlyUnlocked) this.emitUnlock(game, a)
    } catch (e) {
      // erreur reseau/jeton : tracee pour diagnostic (un echec silencieux = bannieres perdues sans indice)
      alog(`ERREUR poll ${game.name} (${game.id}) : ${(e as Error).message}`)
    }
  }

  private async sweepXboxRecent(): Promise<void> {
    if (!isXboxConnected().connected) return
    const recent = getGames()
      .filter((g) => g.platform === 'xbox' && (g.lastPlayed ?? 0) > Date.now() - 7 * 86400_000)
      // les plus récemment joués d'abord — sinon, avec plus de 10 titres joués cette semaine,
      // celui qu'on est en train d'y jouer maintenant pouvait ne jamais être sélectionné
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 10)
    for (const game of recent) {
      // Évite le double poll si le jeu est déjà surveillé activement (timer dédié)
      // ou couvert par le poll rapide du jeu actif.
      if (this.timers.has(game.id) || game.id === this.activeXboxId) continue
      await this.pollOnce(game)
      await new Promise((r) => setTimeout(r, 1_000))
    }
  }
}

export const achievementPoller = new AchievementPoller()
