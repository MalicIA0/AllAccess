import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, readdirSync } from 'fs'
import { basename } from 'path'
import type { Game } from '../../shared/types'

const execFileAsync = promisify(execFile)

/**
 * Ubisoft Connect n'expose aucune connexion officielle par jetons (uniquement un
 * login par mot de passe, souvent bloqué par captcha/2FA) — comme pour Rockstar,
 * on se limite donc à détecter les jeux déjà INSTALLÉS localement, via le registre
 * du launcher : HKLM\...\Ubisoft\Launcher\Installs\<gameId>\InstallDir.
 * Lancement ensuite par l'URI officielle uplay://launch/<gameId>/0.
 */

const INSTALLS_ROOT = 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs'

// Jaquettes connues (mêmes jeux sur Steam) — évite une carte vide pour les gros titres
const KNOWN_COVERS: { match: RegExp; steamAppId: string }[] = [
  { match: /valhalla/i, steamAppId: '2208920' },
  { match: /odyssey/i, steamAppId: '812140' },
  { match: /origins/i, steamAppId: '582160' },
  { match: /mirage/i, steamAppId: '2225070' },
  { match: /far cry\s*6/i, steamAppId: '2369390' },
  { match: /far cry\s*5/i, steamAppId: '552520' },
  { match: /watch dogs.*legion/i, steamAppId: '2239550' },
  { match: /rainbow six.*siege/i, steamAppId: '359550' },
  { match: /the crew\s*2/i, steamAppId: '646910' },
  { match: /the division\s*2/i, steamAppId: '2221490' },
  { match: /ghost recon.*breakpoint/i, steamAppId: '2231380' },
  { match: /anno\s*1800/i, steamAppId: '916440' }
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

const EXE_BLACKLIST =
  /unins|crash|redist|vcredist|dxsetup|dotnet|setup|installer|launcher|report|eac|easyanticheat|be_|upc|ubisoftconnect/i

function findMainExe(dir: string): string | null {
  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.toLowerCase().endsWith('.exe') && !EXE_BLACKLIST.test(f.name))
      .map((f) => f.name)
    if (files.length === 0) return null
    return files.sort((a, b) => b.length - a.length)[0]
  } catch {
    return null
  }
}

interface UbiInstall {
  gameId: string
  installDir: string
}

async function listInstalls(): Promise<UbiInstall[]> {
  let subkeys: string[] = []
  try {
    const { stdout } = await execFileAsync('reg', ['query', INSTALLS_ROOT])
    const marker = '\\Installs\\'
    subkeys = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.includes(marker))
  } catch {
    return [] // Ubisoft Connect non installé, ou aucun jeu
  }

  const installs: UbiInstall[] = []
  for (const keyPath of subkeys) {
    const gameId = keyPath.slice(keyPath.lastIndexOf('\\') + 1).trim()
    if (!/^\d+$/.test(gameId)) continue
    try {
      const { stdout } = await execFileAsync('reg', ['query', keyPath, '/v', 'InstallDir'])
      const m = stdout.match(/InstallDir\s+REG_SZ\s+(.+)/)
      if (m) installs.push({ gameId, installDir: m[1].trim().replace(/[\\/]+$/, '') })
    } catch {
      /* clé sans InstallDir */
    }
  }
  return installs
}

/** Jeux Ubisoft installés sur ce PC (pas de compte requis). Le nom vient du dossier d'installation. */
export async function scanInstalledUbisoftGames(): Promise<Game[]> {
  const installs = await listInstalls()
  const games: Game[] = []
  for (const { gameId, installDir } of installs) {
    if (!installDir || !existsSync(installDir)) continue
    const exe = findMainExe(installDir)
    if (!exe) continue
    const name = basename(installDir)
    const { coverUrl, heroUrl } = coverFor(name)
    games.push({
      id: `ubisoft:${gameId}`,
      platform: 'ubisoft',
      externalId: gameId,
      name,
      ownership: 'owned',
      ownershipOverride: null,
      hidden: false,
      installed: true,
      installDir,
      exeHints: [exe.toLowerCase()],
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
