import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { Game } from '../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * Pas d'API de compte Rockstar disponible (Social Club fermé, pas de flux OAuth fiable) —
 * on se limite donc à détecter les jeux déjà installés localement via le registre, comme
 * le fait le Rockstar Games Launcher lui-même. Pas de bibliothèque complète, pas de jeux
 * non installés : uniquement ce qui est physiquement présent sur ce PC.
 */

const REG_ROOT = 'HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games'
// Sous-clés du registre qui ne sont pas des jeux
const NON_GAME_KEYS = new Set(['launcher', 'rockstar games social club', 'steam'])

// Jaquettes connues (mêmes jeux disponibles sur Steam) — sert juste à ne pas afficher une carte vide
const KNOWN_COVERS: { match: RegExp; steamAppId: string }[] = [
  { match: /grand theft auto v(?!i)|\bgtav\b/i, steamAppId: '271590' },
  { match: /grand theft auto iv/i, steamAppId: '12210' },
  { match: /red dead redemption 2/i, steamAppId: '1174180' },
  { match: /red dead redemption(?! 2)/i, steamAppId: '1734247' },
  { match: /max payne 3/i, steamAppId: '204100' },
  { match: /l\.?a\.? noire/i, steamAppId: '4650' },
  { match: /bully/i, steamAppId: '12400' }
]

function coverFor(name: string): { coverUrl: string | null; heroUrl: string | null } {
  const hit = KNOWN_COVERS.find((k) => k.match.test(name))
  if (!hit) return { coverUrl: null, heroUrl: null }
  const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps'
  return {
    coverUrl: `${CDN}/${hit.steamAppId}/library_600x900.jpg`,
    heroUrl: `${CDN}/${hit.steamAppId}/library_hero.jpg`
  }
}

const EXE_BLACKLIST = /unins|crash|redist|vcredist|dxsetup|dotnet|setup|installer|launcher|report|eac|easyanticheat|be_/i

function findMainExe(dir: string): string | null {
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.exe') && !EXE_BLACKLIST.test(f.name))
      .map((f) => f.name)
    if (files.length === 0) return null
    // heuristique simple : le plus gros exécutable est généralement le jeu
    return files.sort((a, b) => b.length - a.length)[0]
  } catch {
    return null
  }
}

interface RegSubkey {
  name: string
  installFolder: string | null
}

async function listRegSubkeys(): Promise<RegSubkey[]> {
  try {
    const { stdout } = await execFileAsync('reg', ['query', REG_ROOT])
    // reg.exe développe "HKLM" en "HKEY_LOCAL_MACHINE" dans sa sortie — on repère donc
    // les sous-clés via le segment "\Rockstar Games\<nom>" plutôt qu'un préfixe exact.
    const marker = '\\Rockstar Games\\'
    const keyPaths = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes(marker))

    const subkeys: RegSubkey[] = []
    for (const keyPath of keyPaths) {
      const name = keyPath.slice(keyPath.indexOf(marker) + marker.length)
      if (NON_GAME_KEYS.has(name.toLowerCase())) continue
      try {
        const { stdout: valOut } = await execFileAsync('reg', ['query', keyPath, '/v', 'InstallFolder'])
        const m = valOut.match(/InstallFolder\s+REG_SZ\s+(.+)/)
        subkeys.push({ name, installFolder: m ? m[1].trim() : null })
      } catch {
        subkeys.push({ name, installFolder: null })
      }
    }
    return subkeys
  } catch {
    return []
  }
}

/**
 * Rockstar laisse parfois une ancienne clé de registre (et son dossier) en place après une mise à
 * niveau gratuite type "Enhanced" (ex. GTA V → GTA V Enhanced) : les deux clés/dossiers existent
 * alors en même temps sur disque, ce qui ferait apparaître deux cartes pour le même jeu — dont une
 * fantôme sans désinstalleur Windows valide. On regroupe donc par titre canonique (sans les mots
 * d'édition) et on ne garde que la variante la plus récente/actuelle.
 */
function canonicalTitle(name: string): string {
  let n = name.toLowerCase()
  // formes abrégées connues → forme complète, pour que "GTAV Enhanced" et "Grand Theft Auto V"
  // (l'ancienne clé de registre laissée par la mise à niveau) se retrouvent dans le même groupe
  n = n.replace(/\bgta\s?v\b/g, 'grand theft auto v')
  n = n.replace(/\bgta\s?iv\b/g, 'grand theft auto iv')
  n = n.replace(/\brdr2\b/g, 'red dead redemption 2')
  n = n.replace(/\brdr\b/g, 'red dead redemption')
  n = n.replace(/\b(enhanced|legacy|definitive edition|remastered)\b/g, '')
  return n.replace(/[^a-z0-9]+/g, '')
}

interface Candidate {
  name: string
  installFolder: string
  exe: string
  mtime: number
}

function dedupeByCanonicalTitle(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const key = canonicalTitle(c.name)
    const arr = groups.get(key) ?? []
    arr.push(c)
    groups.set(key, arr)
  }
  const out: Candidate[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0])
      continue
    }
    // priorité à la variante "Enhanced"/"Remastered"/"Definitive Edition" si présente, sinon au
    // dossier modifié le plus récemment (la version qu'on vient d'installer/mettre à jour)
    const upgraded = group.find((c) => /\b(enhanced|remastered|definitive edition)\b/i.test(c.name))
    out.push(upgraded ?? [...group].sort((a, b) => b.mtime - a.mtime)[0])
  }
  return out
}

/** Jeux Rockstar déjà installés sur ce PC, détectés via le registre (pas de compte requis). */
export async function scanInstalledRockstarGames(): Promise<Game[]> {
  const subkeys = await listRegSubkeys()
  const candidates: Candidate[] = []
  for (const { name, installFolder } of subkeys) {
    if (!installFolder || !existsSync(installFolder)) continue
    const exe = findMainExe(installFolder)
    if (!exe) continue
    const mtime = statSync(installFolder).mtimeMs
    candidates.push({ name, installFolder, exe, mtime })
  }

  const games: Game[] = []
  for (const { name: rawName, installFolder, exe } of dedupeByCanonicalTitle(candidates)) {
    // affichage plus lisible que le texte brut de la clé de registre ("GTAV Enhanced" → "Grand Theft Auto V Enhanced")
    const name = rawName.replace(/^gtav\b/i, 'Grand Theft Auto V').replace(/^gta\s?iv\b/i, 'Grand Theft Auto IV')
    const { coverUrl, heroUrl } = coverFor(name)
    games.push({
      id: `rockstar:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      platform: 'rockstar',
      externalId: name,
      name,
      ownership: 'owned',
      ownershipOverride: null,
      hidden: false,
      installed: true,
      installDir: installFolder,
      exeHints: [exe],
      devices: ['PC'],
      playtimeMinutes: 0,
      lastPlayed: null,
      coverUrl,
      heroUrl,
      storeProductId: null,
      achievementsTotal: 0,
      achievementsUnlocked: 0,
      dlcOwned: 0,
      dlcTotal: 0,
      updatedAt: Date.now()
    })
  }
  return games
}
