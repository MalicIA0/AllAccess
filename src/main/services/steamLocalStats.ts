import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getSteamRoot } from './steam'

/**
 * Récupération des succès Steam SANS session ni réseau.
 *
 * Le client Steam garde sur le disque, dans `appcache/stats/`, l'état des succès de chaque jeu :
 *  - `UserGameStatsSchema_<appid>.bin` : le catalogue du jeu. Les succès y sont rangés dans un ou
 *    plusieurs « champs de bits » (une stat entière de 32 bits = 32 succès), chaque bit portant son
 *    nom d'API et ses libellés traduits.
 *  - `UserGameStats_<idCompte>_<appid>.bin` : l'état du joueur. Pour chaque champ de bits, `data`
 *    est l'entier dont les bits allumés sont les succès obtenus, et `AchievementTimes` donne la
 *    DATE EXACTE de chaque déblocage.
 *
 * C'est ce qui rend ce chemin précieux : il fonctionne compte déconnecté, hors ligne, et il rend
 * les vraies heures — là où le scraping de la page communautaire ne donne aucune heure et oblige
 * à approximer avec l'instant de la synchro.
 *
 * Les deux fichiers sont au format « KeyValues binaire » de Valve, d'où le petit lecteur ci-dessous.
 */

type KVNode = { [key: string]: KVNode | string | number }

/** Types de champ du format : 00 objet, 01 chaîne, 02 int32, 03 float, 04/05 uint32, 06/07 int64. */
function parseBinKV(buf: Buffer): KVNode {
  let p = 0
  const str = (): string => {
    const start = p
    while (p < buf.length && buf[p] !== 0) p++
    return buf.toString('utf8', start, p++)
  }
  const node = (): KVNode => {
    const out: KVNode = {}
    while (p < buf.length) {
      const type = buf[p++]
      if (type === 8) return out // marqueur de fin d'objet
      const key = str()
      if (type === 0) out[key] = node()
      else if (type === 1) out[key] = str()
      else if (type === 2) {
        out[key] = buf.readInt32LE(p)
        p += 4
      } else if (type === 3) {
        out[key] = buf.readFloatLE(p)
        p += 4
      } else if (type === 4 || type === 5) {
        out[key] = buf.readUInt32LE(p)
        p += 4
      } else if (type === 6 || type === 7) {
        out[key] = Number(buf.readBigInt64LE(p))
        p += 8
      } else throw new Error(`champ de type inconnu 0x${type.toString(16)}`)
    }
    return out
  }
  p++ // type du noeud racine
  str() // nom du noeud racine (l'appid)
  return node()
}

/**
 * Compare deux libellés de succès. Indispensable : le schéma Steam écrit « Home Run <U+00A0>! »
 * avec une espace INSÉCABLE avant le point d'exclamation, là où la page communautaire (source des
 * succès déjà en base) met une espace ordinaire. Sans ça, 42 succès sur 43 se retrouvent.
 */
export function normalizeLabel(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[\u00a0\u202f\u2007\u2060]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export type LocalUnlock = { label: string; apiName: string; unlockTime: number | null }

/** Succès obtenus d'après le cache Steam local, avec leur date réelle. [] si indisponible. */
export async function readLocalSteamUnlocks(appid: string): Promise<LocalUnlock[]> {
  const root = await getSteamRoot()
  if (!root) return []
  const dir = join(root, 'appcache', 'stats')
  const schemaFile = join(dir, `UserGameStatsSchema_${appid}.bin`)
  if (!existsSync(dir) || !existsSync(schemaFile)) return []

  // plusieurs comptes Steam peuvent avoir joué sur ce PC → on prend le fichier le plus récent,
  // c'est celui du compte réellement utilisé
  const userFile = readdirSync(dir)
    .filter((f) => f.startsWith('UserGameStats_') && f.endsWith(`_${appid}.bin`))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  if (!userFile) return []

  try {
    const schema = parseBinKV(readFileSync(schemaFile))
    const stats = schema.stats as KVNode | undefined
    // parseBinKV retire déjà le noeud racine : pour le fichier joueur ce noeud EST « cache »,
    // donc ce qui est renvoyé est directement son contenu — pas de `.cache` à rajouter derrière.
    const user = parseBinKV(readFileSync(userFile))
    if (!stats) return []

    const out: LocalUnlock[] = []
    for (const [statId, rawDef] of Object.entries(stats)) {
      const def = rawDef as KVNode
      const bits = def.bits as KVNode | undefined
      if (!bits) continue // stat ordinaire (compteur de jeu), pas un champ de bits de succès
      const mine = user[statId] as KVNode | undefined
      if (!mine) continue
      const field = Number(mine.data ?? 0) >>> 0
      const times = (mine.AchievementTimes ?? {}) as KVNode
      for (const [bit, rawAch] of Object.entries(bits)) {
        const index = Number(bit)
        if (!Number.isInteger(index) || index < 0 || index > 31) continue
        if ((field & (1 << index)) === 0) continue // succès non obtenu
        const ach = rawAch as KVNode
        const display = ach.display as KVNode | undefined
        const names = display?.name as KVNode | undefined
        const label = (names?.french ?? names?.english) as string | undefined
        if (!label) continue
        const t = Number(times[bit] ?? 0)
        out.push({
          label,
          apiName: String(ach.name ?? ''),
          unlockTime: t > 0 ? t * 1000 : null
        })
      }
    }
    return out.sort((a, b) => (a.unlockTime ?? 0) - (b.unlockTime ?? 0))
  } catch {
    return [] // cache absent, tronqué ou format inattendu : on ne casse rien, on ne récupère rien
  }
}
