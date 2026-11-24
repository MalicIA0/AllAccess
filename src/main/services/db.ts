import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { Achievement, AppItem, Game, Ownership, PlaySession } from '../../shared/types'

let db: Database.Database

export function initDb(): void {
  db = new Database(join(app.getPath('userData'), 'gamevault.db'))
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ownership TEXT NOT NULL DEFAULT 'owned',
      ownership_override TEXT,
      installed INTEGER NOT NULL DEFAULT 0,
      install_dir TEXT,
      exe_hints TEXT NOT NULL DEFAULT '[]',
      playtime_minutes INTEGER NOT NULL DEFAULT 0,
      last_played INTEGER,
      cover_url TEXT,
      hero_url TEXT,
      store_product_id TEXT,
      achievements_total INTEGER NOT NULL DEFAULT 0,
      achievements_unlocked INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS achievements (
      game_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon_url TEXT,
      icon_gray_url TEXT,
      unlocked INTEGER NOT NULL DEFAULT 0,
      unlock_time INTEGER,
      rarity REAL,
      PRIMARY KEY (game_id, key)
    );
    CREATE TABLE IF NOT EXISTS play_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'xbox',
      product_id TEXT NOT NULL,
      name TEXT NOT NULL,
      installed INTEGER NOT NULL DEFAULT 0,
      cover_url TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ach_game ON achievements(game_id);
    CREATE INDEX IF NOT EXISTS idx_ach_unlock ON achievements(unlocked, unlock_time);
  `)
  // migrations légères
  try {
    db.exec("ALTER TABLE games ADD COLUMN devices TEXT NOT NULL DEFAULT '[]'")
  } catch {
    /* colonne déjà présente */
  }
  try {
    db.exec('ALTER TABLE games ADD COLUMN store_product_id TEXT')
  } catch {
    /* colonne déjà présente */
  }
  try {
    db.exec("ALTER TABLE apps ADD COLUMN platform TEXT NOT NULL DEFAULT 'xbox'")
  } catch {
    /* colonne déjà présente */
  }
  try {
    db.exec('ALTER TABLE games ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* colonne déjà présente */
  }
  try {
    db.exec('ALTER TABLE games ADD COLUMN dlc_owned INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* colonne déjà présente */
  }
  try {
    db.exec('ALTER TABLE games ADD COLUMN dlc_total INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* colonne déjà présente */
  }
  try {
    // DLC saisis manuellement : la synchro auto ne doit pas les réécraser
    db.exec('ALTER TABLE games ADD COLUMN dlc_manual INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* colonne déjà présente */
  }
  // les images du Store Microsoft arrivent en http:// — la CSP n'autorise que https://
  db.exec(`
    UPDATE games SET cover_url = REPLACE(cover_url, 'http://', 'https://') WHERE cover_url LIKE 'http://%';
    UPDATE games SET hero_url = REPLACE(hero_url, 'http://', 'https://') WHERE hero_url LIKE 'http://%';
  `)
  // Réconciliation au démarrage : une session encore "en cours" (ended_at NULL) ne peut être que
  // le reliquat d'un crash/kill d'All Access pendant qu'un jeu tournait (le happy path la clôt
  // toujours via processWatcher) — on la referme sur son propre started_at pour ne pas fausser
  // le temps de jeu ni laisser le Dashboard afficher indéfiniment une session fantôme.
  db.exec('UPDATE play_sessions SET ended_at = started_at WHERE ended_at IS NULL')
}

/* ---------- mapping ---------- */

function rowToGame(r: Record<string, unknown>): Game {
  return {
    id: r.id as string,
    platform: r.platform as Game['platform'],
    externalId: r.external_id as string,
    name: r.name as string,
    ownership: r.ownership as Ownership,
    ownershipOverride: (r.ownership_override as Ownership | null) ?? null,
    hidden: !!r.hidden,
    installed: !!r.installed,
    installDir: (r.install_dir as string | null) ?? null,
    exeHints: JSON.parse((r.exe_hints as string) || '[]'),
    devices: JSON.parse((r.devices as string) || '[]'),
    playtimeMinutes: r.playtime_minutes as number,
    lastPlayed: (r.last_played as number | null) ?? null,
    coverUrl: (r.cover_url as string | null) ?? null,
    heroUrl: (r.hero_url as string | null) ?? null,
    storeProductId: (r.store_product_id as string | null) ?? null,
    achievementsTotal: r.achievements_total as number,
    achievementsUnlocked: r.achievements_unlocked as number,
    dlcOwned: (r.dlc_owned as number | null) ?? 0,
    dlcTotal: (r.dlc_total as number | null) ?? 0,
    dlcManual: !!r.dlc_manual,
    updatedAt: r.updated_at as number
  }
}

function rowToAchievement(r: Record<string, unknown>): Achievement {
  return {
    gameId: r.game_id as string,
    key: r.key as string,
    name: r.name as string,
    description: r.description as string,
    iconUrl: (r.icon_url as string | null) ?? null,
    iconGrayUrl: (r.icon_gray_url as string | null) ?? null,
    unlocked: !!r.unlocked,
    unlockTime: (r.unlock_time as number | null) ?? null,
    rarity: (r.rarity as number | null) ?? null
  }
}

/* ---------- games ---------- */

/** Met à jour UNIQUEMENT le statut « installé » d'un jeu (sans toucher aux autres champs). */
export function setGameInstalled(id: string, installed: boolean): void {
  db.prepare('UPDATE games SET installed = ?, updated_at = ? WHERE id = ?').run(installed ? 1 : 0, Date.now(), id)
}

export function upsertGame(g: Omit<Game, 'ownershipOverride' | 'updatedAt' | 'hidden'>): void {
  db.prepare(
    `INSERT INTO games (id, platform, external_id, name, ownership, installed, install_dir, exe_hints, devices,
       playtime_minutes, last_played, cover_url, hero_url, store_product_id, achievements_total, achievements_unlocked, updated_at)
     VALUES (@id, @platform, @externalId, @name, @ownership, @installed, @installDir, @exeHints, @devices,
       @playtimeMinutes, @lastPlayed, @coverUrl, @heroUrl, @storeProductId, @achievementsTotal, @achievementsUnlocked, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, ownership=excluded.ownership, installed=excluded.installed,
       install_dir=excluded.install_dir, exe_hints=excluded.exe_hints, devices=excluded.devices,
       playtime_minutes=excluded.playtime_minutes, last_played=excluded.last_played,
       cover_url=excluded.cover_url, hero_url=excluded.hero_url, store_product_id=excluded.store_product_id,
       -- Compteurs de succès : dès qu'on a des succès RÉELLEMENT stockés pour ce jeu, ils font foi
       -- (on les recompte). Sinon seulement on garde l'estimation fournie par l'appelant (titlehub Xbox),
       -- qui renvoie hélas souvent total=0 → sans ce garde-fou, un 0 écrasait 700 succès bien présents
       -- et la carte n'affichait plus aucune barre de progression. Auto-réparateur au prochain upsert.
       achievements_total = CASE WHEN (SELECT COUNT(*) FROM achievements WHERE game_id = games.id) > 0
         THEN (SELECT COUNT(*) FROM achievements WHERE game_id = games.id)
         ELSE excluded.achievements_total END,
       achievements_unlocked = CASE WHEN (SELECT COUNT(*) FROM achievements WHERE game_id = games.id) > 0
         THEN (SELECT COUNT(*) FROM achievements WHERE game_id = games.id AND unlocked = 1)
         ELSE excluded.achievements_unlocked END,
       updated_at=excluded.updated_at`
  ).run({
    id: g.id,
    platform: g.platform,
    externalId: g.externalId,
    name: g.name,
    ownership: g.ownership,
    installed: g.installed ? 1 : 0,
    installDir: g.installDir,
    exeHints: JSON.stringify(g.exeHints),
    devices: JSON.stringify(g.devices),
    playtimeMinutes: g.playtimeMinutes,
    lastPlayed: g.lastPlayed,
    coverUrl: g.coverUrl,
    heroUrl: g.heroUrl,
    storeProductId: g.storeProductId,
    achievementsTotal: g.achievementsTotal,
    achievementsUnlocked: g.achievementsUnlocked,
    updatedAt: Date.now()
  })
}

export function getGames(): Game[] {
  return (db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[]).map(rowToGame)
}

export function getGame(id: string): Game | null {
  const r = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return r ? rowToGame(r) : null
}

/**
 * Supprime les jeux d'une plateforme absents de la dernière sync (ex-Game Pass, console-only…).
 * `allowEmpty` : pour les scans LOCAUX (Rockstar/Ubisoft), une liste vide est un état légitime
 * (dernier jeu désinstallé) et doit bien tout purger — alors que pour les sources réseau, une
 * sync vide est presque toujours un échec d'API et ne doit jamais vider la base.
 */
export function pruneGames(platform: Game['platform'], keepIds: string[], opts?: { allowEmpty?: boolean }): void {
  if (keepIds.length === 0 && !opts?.allowEmpty) return // sécurité : une sync vide ne doit pas vider la base
  // NOT IN () est invalide en SQL → clause neutre quand on purge tout
  const notIn = keepIds.length > 0 ? `AND id NOT IN (${keepIds.map(() => '?').join(',')})` : ''
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM achievements WHERE game_id IN (SELECT id FROM games WHERE platform = ? ${notIn})`
    ).run(platform, ...keepIds)
    db.prepare(
      `DELETE FROM play_sessions WHERE game_id IN (SELECT id FROM games WHERE platform = ? ${notIn})`
    ).run(platform, ...keepIds)
    db.prepare(`DELETE FROM games WHERE platform = ? ${notIn}`).run(platform, ...keepIds)
  })
  tx()
}

export function setOwnershipOverride(id: string, ownership: Ownership | null): void {
  db.prepare('UPDATE games SET ownership_override = ? WHERE id = ?').run(ownership, id)
}

export function setGameHidden(id: string, hidden: boolean): void {
  db.prepare('UPDATE games SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id)
}

/**
 * Supprime définitivement un jeu (succès, sessions de jeu, fiche) — utilisé depuis « Jeux
 * masqués » pour faire le ménage. Si le jeu est toujours possédé sur sa plateforme, la
 * prochaine synchro le recréera (la suppression n'agit pas sur le compte, seulement sur cette
 * base locale).
 */
export function deleteGame(id: string): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM achievements WHERE game_id = ?').run(id)
    db.prepare('DELETE FROM play_sessions WHERE game_id = ?').run(id)
    db.prepare('DELETE FROM games WHERE id = ?').run(id)
  })
  tx()
}

/** Normalise un titre pour repérer un même jeu possédé sur plusieurs plateformes. */
function normalizeTitle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(
      /\b(edition|deluxe|standard|ultimate|goty|game of the year|remastered|definitive|complete|version\s*am[ée]lior[ée]e?|directors?\s*cut)\b/g,
      ''
    )
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

const DUPLICATE_PLATFORM_PRIORITY: Record<Game['platform'], number> = {
  steam: 0,
  xbox: 1,
  epic: 2,
  ubisoft: 3,
  rockstar: 4
}

/**
 * Masque automatiquement les doublons d'un même jeu possédé sur plusieurs plateformes (ex.
 * Destiny 2 sur Steam ET Xbox) — ne garde visible que la copie la plus pertinente (installée >
 * succès les plus avancés > temps de jeu le plus long). Non destructif : utilise le `hidden`
 * habituel, donc réversible à tout moment depuis « Jeux masqués » dans la Bibliothèque.
 * Retourne le nombre de jeux nouvellement masqués.
 */
export function hideCrossPlatformDuplicates(): number {
  const games = (db.prepare('SELECT * FROM games').all() as Record<string, unknown>[]).map(rowToGame)
  const groups = new Map<string, Game[]>()
  for (const g of games) {
    const key = normalizeTitle(g.name)
    if (!key) continue
    const arr = groups.get(key) ?? []
    arr.push(g)
    groups.set(key, arr)
  }
  let hiddenCount = 0
  const tx = db.transaction(() => {
    for (const arr of groups.values()) {
      // seuls les doublons ENTRE plateformes différentes comptent
      if (arr.length < 2 || new Set(arr.map((g) => g.platform)).size < 2) continue
      const sorted = [...arr].sort((a, b) => {
        if (a.installed !== b.installed) return a.installed ? -1 : 1
        if (a.achievementsUnlocked !== b.achievementsUnlocked) return b.achievementsUnlocked - a.achievementsUnlocked
        if (a.playtimeMinutes !== b.playtimeMinutes) return b.playtimeMinutes - a.playtimeMinutes
        return (DUPLICATE_PLATFORM_PRIORITY[a.platform] ?? 9) - (DUPLICATE_PLATFORM_PRIORITY[b.platform] ?? 9)
      })
      for (const g of sorted.slice(1)) {
        if (!g.hidden) {
          db.prepare('UPDATE games SET hidden = 1 WHERE id = ?').run(g.id)
          hiddenCount++
        }
      }
    }
  })
  tx()
  return hiddenCount
}

/**
 * Met à jour le décompte des DLC possédés. Calculé dans une passe séparée après la sync
 * de base — `upsertGame` ne touche jamais ces colonnes, elles persistent donc entre deux syncs.
 * Ne touche jamais un jeu dont les DLC ont été saisis à la main (dlc_manual = 1).
 */
export function setDlcCounts(id: string, owned: number, total: number): void {
  db.prepare('UPDATE games SET dlc_owned = ?, dlc_total = ? WHERE id = ? AND dlc_manual = 0').run(owned, total, id)
}

/**
 * Saisie manuelle des DLC possédés (ex. Destiny 2, dont Steam ne remonte pas les extensions
 * gérées côté serveur Bungie). Marque le jeu comme « manuel » pour que la synchro ne l'écrase plus.
 * `total = 0` remet le jeu en détection automatique.
 */
export function setDlcManual(id: string, owned: number, total: number): void {
  if (total <= 0) {
    db.prepare('UPDATE games SET dlc_owned = 0, dlc_total = 0, dlc_manual = 0 WHERE id = ?').run(id)
    return
  }
  const clampedOwned = Math.max(0, Math.min(owned, total))
  db.prepare('UPDATE games SET dlc_owned = ?, dlc_total = ?, dlc_manual = 1 WHERE id = ?').run(clampedOwned, total, id)
}

/** Nombre de succès stockés par jeu (game_id → nb de lignes) — sert à repérer les jeux à rattraper. */
export function achievementRowCounts(): Map<string, number> {
  const rows = db.prepare('SELECT game_id, COUNT(*) n FROM achievements GROUP BY game_id').all() as {
    game_id: string
    n: number
  }[]
  return new Map(rows.map((r) => [r.game_id, r.n]))
}

export function updateAchievementCounts(gameId: string): void {
  db.prepare(
    `UPDATE games SET
       achievements_total = (SELECT COUNT(*) FROM achievements WHERE game_id = ?),
       achievements_unlocked = (SELECT COUNT(*) FROM achievements WHERE game_id = ? AND unlocked = 1)
     WHERE id = ?`
  ).run(gameId, gameId, gameId)
}

/* ---------- achievements ---------- */

export function upsertAchievements(gameId: string, list: Achievement[]): Achievement[] {
  // Retourne les succès NOUVELLEMENT débloqués (pour les notifications)
  const newlyUnlocked: Achievement[] = []
  const existing = new Map(
    (db.prepare('SELECT key, unlocked FROM achievements WHERE game_id = ?').all(gameId) as {
      key: string
      unlocked: number
    }[]).map((r) => [r.key, !!r.unlocked])
  )
  const stmt = db.prepare(
    `INSERT INTO achievements (game_id, key, name, description, icon_url, icon_gray_url, unlocked, unlock_time, rarity)
     VALUES (@gameId, @key, @name, @description, @iconUrl, @iconGrayUrl, @unlocked, @unlockTime, @rarity)
     ON CONFLICT(game_id, key) DO UPDATE SET
       name=excluded.name, description=excluded.description, icon_url=excluded.icon_url,
       icon_gray_url=excluded.icon_gray_url,
       -- « collant » : un succès débloqué ne se re-verrouille jamais via une synchro (une passe
       -- bancale — session Steam déconnectée, page publique partielle — ne peut pas effacer un acquis)
       unlocked=MAX(achievements.unlocked, excluded.unlocked),
       -- garde la 1re date de déblocage connue (les pages Steam HTML ne donnent pas l'heure exacte)
       unlock_time=COALESCE(achievements.unlock_time, excluded.unlock_time), rarity=excluded.rarity`
  )
  const tx = db.transaction((items: Achievement[]) => {
    for (const a of items) {
      stmt.run({ ...a, unlocked: a.unlocked ? 1 : 0 })
      if (a.unlocked && existing.has(a.key) && !existing.get(a.key)) newlyUnlocked.push(a)
    }
  })
  tx(list)
  updateAchievementCounts(gameId)
  return newlyUnlocked
}

/**
 * Coche/décoche manuellement un succès bonus (clé `xbox-bonus:*`, importé via
 * `fetchXboxBonusAchievements`) — jamais autorisé sur un vrai succès synchronisé, qui serait
 * de toute façon réécrit à la prochaine sync.
 */
export function setManualAchievementUnlock(
  gameId: string,
  key: string,
  unlocked: boolean,
  /** Date réelle du déblocage si on la connaît (cache Steam local) ; sinon « maintenant ». */
  at?: number
): void {
  db.prepare('UPDATE achievements SET unlocked = ?, unlock_time = ? WHERE game_id = ? AND key = ?').run(
    unlocked ? 1 : 0,
    unlocked ? (at ?? Date.now()) : null,
    gameId,
    key
  )
  updateAchievementCounts(gameId)
}

/**
 * Supprime les succès `xbox-bonus:*` (import manuel) devenus redondants parce qu'un vrai succès
 * synchronisé porte le même nom — évite les doublons quand un jeu possède désormais ses vrais
 * succès (ex. Wukong dont les 81 succès Steam = les 81 Xbox importés à la main).
 */
export function removeBonusDuplicates(gameId: string): void {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const rows = db.prepare('SELECT key, name FROM achievements WHERE game_id = ?').all(gameId) as {
    key: string
    name: string
  }[]
  const realNames = new Set(rows.filter((r) => !r.key.startsWith('xbox-bonus:')).map((r) => norm(r.name)))
  const toDelete = rows.filter((r) => r.key.startsWith('xbox-bonus:') && realNames.has(norm(r.name))).map((r) => r.key)
  if (toDelete.length === 0) return
  const del = db.prepare('DELETE FROM achievements WHERE game_id = ? AND key = ?')
  db.transaction(() => {
    for (const k of toDelete) del.run(gameId, k)
  })()
  updateAchievementCounts(gameId)
}

export function getAchievements(gameId: string): Achievement[] {
  return (
    db.prepare('SELECT * FROM achievements WHERE game_id = ? ORDER BY unlocked DESC, unlock_time DESC, rarity DESC').all(gameId) as Record<string, unknown>[]
  ).map(rowToAchievement)
}

/* ---------- sessions ---------- */

export function startSession(gameId: string): number {
  const res = db.prepare('INSERT INTO play_sessions (game_id, started_at) VALUES (?, ?)').run(gameId, Date.now())
  db.prepare('UPDATE games SET last_played = ? WHERE id = ?').run(Date.now(), gameId)
  return Number(res.lastInsertRowid)
}

export function endSession(sessionId: number): void {
  db.prepare('UPDATE play_sessions SET ended_at = ? WHERE id = ?').run(Date.now(), sessionId)
}

/* ---------- dashboard ---------- */

export function getStats(): {
  games: Record<string, unknown>[]
  recentUnlocks: Record<string, unknown>[]
  recentSessions: Record<string, unknown>[]
  nextChallenges: Record<string, unknown>[]
} {
  return {
    // Défis suggérés : succès verrouillés les plus accessibles (rareté élevée)
    // dans des jeux déjà entamés et joués récemment
    // les jeux masqués ne doivent apparaître dans aucune statistique du Dashboard
    nextChallenges: db
      .prepare(
        `SELECT a.*, g.name AS game_name, g.cover_url AS game_cover
         FROM achievements a JOIN games g ON g.id = a.game_id
         WHERE a.unlocked = 0
           AND a.rarity IS NOT NULL
           AND g.achievements_unlocked > 0
           AND g.achievements_unlocked < g.achievements_total
           AND g.hidden = 0
         ORDER BY (g.last_played IS NULL), g.last_played DESC, a.rarity DESC
         LIMIT 10`
      )
      .all() as Record<string, unknown>[],
    games: db.prepare('SELECT * FROM games WHERE hidden = 0').all() as Record<string, unknown>[],
    recentUnlocks: db
      .prepare(
        `SELECT a.*, g.name AS game_name, g.cover_url AS game_cover
         FROM achievements a JOIN games g ON g.id = a.game_id
         WHERE a.unlocked = 1 AND a.unlock_time IS NOT NULL AND g.hidden = 0
         ORDER BY a.unlock_time DESC LIMIT 12`
      )
      .all() as Record<string, unknown>[],
    recentSessions: db
      .prepare(
        `SELECT s.*, g.name AS game_name FROM play_sessions s JOIN games g ON g.id = s.game_id
         WHERE g.hidden = 0
         ORDER BY s.started_at DESC LIMIT 10`
      )
      .all() as Record<string, unknown>[]
  }
}

export function rowToPublicAchievement(r: Record<string, unknown>): Achievement {
  return rowToAchievement(r)
}

export function rowToPublicGame(r: Record<string, unknown>): Game {
  return rowToGame(r)
}

/* ---------- applications (hors jeux) ---------- */

function rowToApp(r: Record<string, unknown>): AppItem {
  return {
    id: r.id as string,
    platform: r.platform as AppItem['platform'],
    productId: r.product_id as string,
    name: r.name as string,
    installed: !!r.installed,
    coverUrl: (r.cover_url as string | null) ?? null,
    updatedAt: r.updated_at as number
  }
}

export function upsertApp(a: Omit<AppItem, 'updatedAt'>): void {
  db.prepare(
    `INSERT INTO apps (id, platform, product_id, name, installed, cover_url, updated_at)
     VALUES (@id, @platform, @productId, @name, @installed, @coverUrl, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, installed=excluded.installed, cover_url=excluded.cover_url, updated_at=excluded.updated_at`
  ).run({
    id: a.id,
    platform: a.platform,
    productId: a.productId,
    name: a.name,
    installed: a.installed ? 1 : 0,
    coverUrl: a.coverUrl,
    updatedAt: Date.now()
  })
}

export function getApps(): AppItem[] {
  return (db.prepare('SELECT * FROM apps ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[]).map(rowToApp)
}

export function getApp(id: string): AppItem | null {
  const r = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return r ? rowToApp(r) : null
}

/** Supprime les apps d'une plateforme absentes de la dernière sync (revendues, plus liées au compte…). */
export function pruneApps(platform: AppItem['platform'], keepIds: string[]): void {
  if (keepIds.length === 0) return
  const ph = keepIds.map(() => '?').join(',')
  db.prepare(`DELETE FROM apps WHERE platform = ? AND id NOT IN (${ph})`).run(platform, ...keepIds)
}

export function rowToSession(r: Record<string, unknown>): PlaySession {
  return {
    id: r.id as number,
    gameId: r.game_id as string,
    startedAt: r.started_at as number,
    endedAt: (r.ended_at as number | null) ?? null
  }
}
