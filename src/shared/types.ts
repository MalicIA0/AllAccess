export type Platform = 'steam' | 'xbox' | 'rockstar' | 'epic' | 'ubisoft'
export type Ownership = 'owned' | 'gamepass' | 'both'

/** Espace disque d'un lecteur fixe (valeurs en Go). */
export interface DiskInfo {
  drive: string // ex. "C:"
  usedGb: number
  freeGb: number
  totalGb: number
}

export interface Game {
  id: string // `${platform}:${externalId}`
  platform: Platform
  externalId: string
  name: string
  ownership: Ownership
  ownershipOverride: Ownership | null
  hidden: boolean
  installed: boolean
  installDir: string | null
  exeHints: string[]
  /** Appareils compatibles ("PC", "XboxSeries", "XboxOne", …) */
  devices: string[]
  playtimeMinutes: number
  lastPlayed: number | null
  coverUrl: string | null
  heroUrl: string | null
  /** ProductId Microsoft Store (jeux Xbox uniquement) — sert à ouvrir la page d'installation */
  storeProductId: string | null
  achievementsTotal: number
  achievementsUnlocked: number
  /** Nombre de DLC/extensions possédés pour ce jeu */
  dlcOwned: number
  /** Nombre total de DLC connus (0 = inconnu → on affiche « +N » au lieu de « N/total ») */
  dlcTotal: number
  /** DLC saisis à la main (ex. Destiny, dont Steam ne remonte pas les extensions) → la synchro ne les écrase pas */
  dlcManual?: boolean
  updatedAt: number
}

export interface Achievement {
  gameId: string
  key: string
  name: string
  description: string
  iconUrl: string | null
  iconGrayUrl: string | null
  unlocked: boolean
  unlockTime: number | null
  rarity: number | null // % global des joueurs qui l'ont
}

export interface PlaySession {
  id: number
  gameId: string
  startedAt: number
  endedAt: number | null
}

export type BgMode =
  | 'off'
  | 'halos'
  | 'halos-particules'
  | 'constellation'
  | 'aurore'
  | 'grille'
  | 'orbes'
  | 'meteores'
  | 'lucioles'
  | 'vortex'
  | 'flux'
  // rendus GPU (WebGL / shaders GLSL)
  | 'nebuleuse'
  | 'plasma'
  | 'liquide'
export type CardSize = 'compact' | 'normal' | 'large'
/** Timbre du carillon de succès */
export type ChimeStyle =
  | 'cristal'
  | 'arcade'
  | 'cinematique'
  | 'cloche'
  | 'harpe'
  | 'fanfare'
  | 'zen'
  | 'laser'
  | 'magie'
  | 'piece'
  | 'digital'
  | 'gong'
  | 'choeur'
/** Style visuel de la notification de succès (overlay) */
export type NotifStyle = 'banniere' | 'toast' | 'cinema' | 'plein' | 'sticker' | 'feuartifice' | 'neon'

export interface AppSettings {
  autostart: boolean
  /** Reconnecte Steam/Xbox/Epic (jetons stockés) au démarrage, puis resynchronise périodiquement */
  autoSyncOnLaunch: boolean
  pollAchievementsSec: number
  /** Fréquence de rafraîchissement de la liste d'amis, en minutes */
  pollFriendsMin: number
  theme: string
  notifSound: boolean
  /** Volume du carillon de succès, 0–100 */
  chimeVolume: number
  /** Timbre du carillon */
  chimeStyle: ChimeStyle
  /** Style de la bannière de succès */
  notifStyle: NotifStyle
  /** Durée d'affichage de la bannière de succès, en secondes (3–30) */
  notifDurationSec: number
  /** Fond animé */
  bgMode: BgMode
  /** Multiplicateur de vitesse du fond animé (0.25 = très lent, 2.5 = très rapide, 1 = normal) */
  bgSpeed: number
  cardSize: CardSize
}

/* ---------------------------- Messages ---------------------------- */

/** Une conversation (fil) avec un ami, sur Steam ou Xbox. */
export interface Conversation {
  id: string
  /** Identifiant de l'interlocuteur (XUID Xbox / steamID64) — sert à ouvrir et répondre au fil. */
  peerId: string
  platform: 'steam' | 'xbox'
  /** Pseudo de l'interlocuteur (gamertag Xbox / persona Steam) */
  name: string
  avatarUrl: string | null
  /** Dernier message du fil, tronqué pour l'aperçu */
  lastMessage: string
  /** Horodatage du dernier message (ms epoch), null si inconnu */
  lastAt: number | null
  unread: number
}

/** État d'une plateforme dans la page Messages : permet d'expliquer une absence de données. */
export interface MessagesPlatformState {
  connected: boolean
  /** Raison lisible quand la plateforme ne peut rien renvoyer (non connecté, API fermée, erreur) */
  note: string | null
}

export interface MessagesResult {
  conversations: Conversation[]
  steam: MessagesPlatformState
  xbox: MessagesPlatformState
}

/** Un message dans un fil de discussion. */
export interface ThreadMessage {
  id: string
  /** true = envoyé par l'utilisateur, false = reçu */
  mine: boolean
  text: string
  at: number | null
  /** Affiché localement juste après l'envoi, en attendant que Xbox le publie dans l'historique. */
  pending?: boolean
}

/** Fil complet d'une conversation, du plus ancien au plus récent. */
export interface ConversationThread {
  /** XUID (Xbox) de l'interlocuteur */
  peerId: string
  name: string
  messages: ThreadMessage[]
  /** Renseigné quand le fil n'a pas pu être chargé (plateforme non supportée, erreur réseau) */
  error: string | null
}

/** Entrée du catalogue Game Pass actuel (indépendante de l'historique du joueur). */
export interface GamePassEntry {
  productId: string
  title: string
  poster: string | null
  hero: string | null
  pc: boolean
  console: boolean
  /** Déjà dans la bibliothèque (déjà joué / succès entamés) */
  inLibrary: boolean
  /** id du jeu de la bibliothèque correspondant, si trouvé */
  libraryGameId: string | null
  installed: boolean
}

export interface AuthStatus {
  steam: { connected: boolean; steamId64?: string }
  xbox: { connected: boolean; gamertag?: string }
  epic: { connected: boolean; displayName?: string }
}

/** Un ami Steam ou Xbox (liste sociale). */
export interface Friend {
  id: string
  platform: 'steam' | 'xbox'
  name: string
  avatarUrl: string | null
  online: boolean
  /** Texte de présence : « En ligne », « Hors ligne », nom du jeu en cours… */
  status: string
  /** Jeu auquel l'ami joue en ce moment, si connu. */
  game: string | null
  /**
   * Début estimé de la session en cours (ms epoch), null si l'ami ne joue pas.
   * Ni Steam ni Xbox ne donnent l'heure de début : elle est estimée côté processus principal,
   * qui observe les amis en continu dès le lancement de l'appli (et non seulement quand la
   * page Amis est ouverte), puis persistée sur disque pour survivre à un redémarrage.
   */
  sessionSince: number | null
}

/** Résultat de la récupération des amis (best-effort par plateforme). */
export interface FriendsResult {
  friends: Friend[]
  errors: string[]
}

/** Un jeu Steam (promo ou catalogue général) — catalogue public, aucun compte requis. */
export interface SteamSpecial {
  appid: number
  name: string
  discountPercent: number
  originalPriceCents: number
  finalPriceCents: number
  currency: string
  imageUrl: string
  /** Fin de la promo, epoch secondes — null si inconnue */
  expiresAt: number | null
  /** Jeu free-to-play (prix affiché « Gratuit » plutôt que 0,00 €) */
  free: boolean
}

/** Promotions Steam du moment : l'offre exceptionnelle du jour + la liste complète des soldes. */
export interface SteamPromos {
  dailyDeal: SteamSpecial | null
  /** Promos PAYANTES : jeux soldés dont le prix final reste > 0. */
  weekly: SteamSpecial[]
  /** Jeux normalement PAYANTS actuellement OFFERTS (‑100 %, à garder définitivement). */
  becomeFree: SteamSpecial[]
}

/** Un jeu Xbox/Microsoft Store en promo — catalogue public xbox.com, aucun compte requis. */
export interface XboxDeal {
  productId: string
  title: string
  discountPercent: number
  originalPriceCents: number
  finalPriceCents: number
  currency: string
  /** Jaquette verticale (poster) ou carrée (boxArt) du Store */
  imageUrl: string
  /** Fin de la promo, epoch secondes — null si inconnue */
  expiresAt: number | null
  pc: boolean
  console: boolean
}

export interface SyncProgress {
  phase: string
  detail: string
  done: boolean
  error?: string
}

export interface DashboardStats {
  totalGames: number
  ownedGames: number
  gamepassGames: number
  installedGames: number
  totalAchievements: number
  unlockedAchievements: number
  playtimeMinutes: number
  perfectGames: number
  recentUnlocks: (Achievement & { gameName: string; coverUrl: string | null })[]
  recentSessions: (PlaySession & { gameName: string })[]
  nextChallenges: (Achievement & { gameName: string; coverUrl: string | null })[]
}

export interface AchievementUnlockedEvent {
  gameId: string
  gameName: string
  achievement: Achievement
  unlockedCount?: number
  totalCount?: number
}

export interface GameSessionEvent {
  gameId: string
  gameName: string
  running: boolean
}

/** Application (hors jeu) — Xbox App, Game Bar, outils Steam (benchmark, wallpaper…). Séparée des jeux. */
export interface AppItem {
  id: string // `app:${platform}:${productId}`
  platform: Platform
  productId: string
  name: string
  installed: boolean
  coverUrl: string | null
  updatedAt: number
}

export interface InstallProgressEvent {
  gameId: string
  gameName: string
  status: 'started' | 'done' | 'error'
  message?: string
}

/**
 * Un jeu en cours de téléchargement.
 * - Xbox/Game Pass : dossier GUID sous XboxGames ; total non exposé → saisi par l'utilisateur.
 * - Steam : lu dans appmanifest_*.acf (BytesDownloaded / BytesToDownload) → progression exacte.
 */
export interface DownloadInfo {
  platform: 'xbox' | 'steam'
  /** Xbox : ProductId Microsoft Store ; Steam : appid — sert à rattacher à la fiche */
  storeId: string | null
  titleId: string | null
  name: string
  /** Octets déjà téléchargés (mesuré en temps réel) */
  downloadedBytes: number
  /** Taille totale en octets (Steam : exacte ; Xbox : saisie par l'utilisateur, null sinon) */
  totalBytes: number | null
  /** true = total fiable fourni par la plateforme (pas de saisie manuelle à proposer) */
  exact: boolean
  /**
   * Téléchargement à l'arrêt côté plateforme (Steam : mis en pause ou en file d'attente).
   * Sans cette information, un téléchargement figé à 0 % ressemble à un bug de l'appli alors
   * que c'est Steam qui attend — l'interface doit pouvoir le dire explicitement.
   */
  paused?: boolean
  /**
   * Cause lisible d'un téléchargement qui n'avance pas du tout (« Espace disque insuffisant
   * (35.67 GB nécessaires) »), extraite du journal de Steam. Sans elle, l'utilisateur voit un
   * 0 % immobile sans savoir que c'est son disque qui est plein.
   */
  blockedReason?: string
  /**
   * Débit instantané en octets/seconde (0 si à l'arrêt ou inconnu). Permet d'afficher la
   * vitesse et le temps restant, et de faire avancer la barre en continu entre deux sondages.
   */
  bytesPerSecond?: number
}

/**
 * Jeu Xbox préchargé : ses fichiers sont sur disque (dossier XboxGames) mais il n'est pas encore
 * SORTI (date de sortie Store dans le futur) → pas encore jouable. Peut être présent ou non dans
 * la bibliothèque (Game Pass day-one non publié).
 */
export interface PreloadInfo {
  /** ProductId Microsoft Store (StoreId du MicrosoftGame.Config) */
  storeId: string
  titleId: string | null
  name: string
  coverUrl: string | null
  /** Date de sortie ISO (future) */
  releaseDate: string | null
  /** id du jeu correspondant en bibliothèque, si présent */
  gameId: string | null
}
