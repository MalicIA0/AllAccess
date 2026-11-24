import { app } from 'electron'
import { appendFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Journal de diagnostic du circuit des succès (%APPDATA%\gamevault\achievements.log) :
 * chaque détection de jeu, chaque poll (avec le nb de nouveaux déblocages) et chaque
 * erreur y sont tracés. Sans lui, un poll qui échoue est invisible et indiagnosticable.
 *
 * Module à part (et non membre du poller) pour que `steam.ts`/`xbox.ts` puissent y écrire
 * sans créer de dépendance circulaire — le poller importe déjà ces services.
 */
export function alog(msg: string): void {
  try {
    const p = join(app.getPath('userData'), 'achievements.log')
    try {
      if (statSync(p).size > 1_000_000) writeFileSync(p, '') // repart proprement au-delà de ~1 Mo
    } catch {
      /* fichier pas encore créé */
    }
    appendFileSync(p, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* le journal ne doit jamais faire planter le poller */
  }
}
