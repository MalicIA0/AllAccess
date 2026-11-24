import { contextBridge, ipcRenderer } from 'electron'
import type {
  Achievement,
  AchievementUnlockedEvent,
  AppItem,
  AppSettings,
  AuthStatus,
  DashboardStats,
  DiskInfo,
  FriendsResult,
  MessagesResult,
  ConversationThread,
  Game,
  GamePassEntry,
  GameSessionEvent,
  InstallProgressEvent,
  Ownership,
  SteamPromos,
  SteamSpecial,
  SyncProgress,
  XboxDeal,
  DownloadInfo,
  PreloadInfo
} from '../shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (s: AppSettings): Promise<void> => ipcRenderer.invoke('settings:set', s),

  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:status'),
  getFriends: (): Promise<FriendsResult> => ipcRenderer.invoke('friends:get'),
  getMessages: (): Promise<MessagesResult> => ipcRenderer.invoke('messages:get'),
  getConversation: (peerId: string): Promise<ConversationThread> => ipcRenderer.invoke('messages:thread', peerId),
  sendMessage: (peerId: string, text: string): Promise<{ ok: boolean; error?: string; messageId?: string }> =>
    ipcRenderer.invoke('messages:send', peerId, text),
  verifySteamSession: (): Promise<boolean> => ipcRenderer.invoke('auth:steam:verify'),
  steamLogin: (): Promise<{ ok: boolean; steamId64?: string; error?: string }> =>
    ipcRenderer.invoke('auth:steam:login'),
  xboxLogin: (): Promise<{ ok: boolean; gamertag?: string; error?: string }> => ipcRenderer.invoke('auth:xbox:login'),
  epicLogin: (): Promise<{ ok: boolean; displayName?: string; error?: string }> =>
    ipcRenderer.invoke('auth:epic:login'),
  steamLogout: (): Promise<void> => ipcRenderer.invoke('auth:steam:logout'),
  xboxLogout: (): Promise<void> => ipcRenderer.invoke('auth:xbox:logout'),
  epicLogout: (): Promise<void> => ipcRenderer.invoke('auth:epic:logout'),

  getLibrary: (): Promise<Game[]> => ipcRenderer.invoke('library:get'),
  getGame: (id: string): Promise<{ game: Game | null; achievements: Achievement[] }> =>
    ipcRenderer.invoke('game:get', id),
  launchGame: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('game:launch', id),
  uninstallGame: (id: string, deleteSave: boolean): Promise<{ ok: boolean; error?: string; message?: string }> =>
    ipcRenderer.invoke('game:uninstall', id, deleteSave),
  setOwnership: (id: string, o: Ownership | null): Promise<void> => ipcRenderer.invoke('game:setOwnership', id, o),
  setHidden: (id: string, hidden: boolean): Promise<void> => ipcRenderer.invoke('game:setHidden', id, hidden),
  deleteGame: (id: string): Promise<void> => ipcRenderer.invoke('game:delete', id),
  setDlcManual: (id: string, owned: number, total: number): Promise<void> =>
    ipcRenderer.invoke('game:setDlcManual', id, owned, total),
  refreshAchievements: (id: string): Promise<Achievement[]> => ipcRenderer.invoke('game:refreshAchievements', id),
  linkXboxAchievements: (
    id: string,
    urlOrId: string
  ): Promise<{ ok: boolean; count?: number; title?: string; error?: string }> =>
    ipcRenderer.invoke('game:linkXboxAchievements', id, urlOrId),
  toggleManualAchievement: (
    gameId: string,
    key: string,
    unlocked: boolean
  ): Promise<{ ok: boolean; error?: string; achievements?: Achievement[] }> =>
    ipcRenderer.invoke('achievement:toggleManual', gameId, key, unlocked),
  recoverOfflineAchievements: (
    gameId: string
  ): Promise<{
    ok: boolean
    error?: string
    achievements?: Achievement[]
    recovered?: number
    redated?: number
    trouves?: number
    noms?: string[]
  }> => ipcRenderer.invoke('achievement:recoverOffline', gameId),

  getGamePassCatalog: (): Promise<GamePassEntry[]> => ipcRenderer.invoke('gamepass:catalog'),
  getGamePassRecent: (): Promise<GamePassEntry[]> => ipcRenderer.invoke('gamepass:recent'),
  getSteamPromos: (): Promise<SteamPromos> => ipcRenderer.invoke('store:steamPromos'),
  getSteamCatalog: (): Promise<SteamSpecial[]> => ipcRenderer.invoke('store:steamCatalog'),
  getSteamFreeGames: (): Promise<SteamSpecial[]> => ipcRenderer.invoke('store:steamFree'),
  getXboxDeals: (): Promise<XboxDeal[]> => ipcRenderer.invoke('store:xboxDeals'),
  openGamePassGame: (productId: string, title: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('gamepass:open', productId, title),
  openGamePassApp: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('catalog:openGamePassApp'),
  openSteamStore: (view: 'catalog' | 'promos'): Promise<void> => ipcRenderer.invoke('catalog:openSteamStore', view),

  getApps: (): Promise<AppItem[]> => ipcRenderer.invoke('apps:get'),
  launchApp: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('app:launch', id),

  runSync: (): Promise<void> => ipcRenderer.invoke('sync:run'),
  isSyncing: (): Promise<boolean> => ipcRenderer.invoke('sync:isRunning'),
  refreshInstalled: (): Promise<boolean> => ipcRenderer.invoke('sync:refreshInstalled'),
  getStats: (): Promise<DashboardStats> => ipcRenderer.invoke('stats:get'),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getDiskUsage: (): Promise<DiskInfo[]> => ipcRenderer.invoke('disk:usage'),
  getActiveDownloads: (): Promise<DownloadInfo[]> => ipcRenderer.invoke('downloads:active'),
  getXboxPreloads: (): Promise<PreloadInfo[]> => ipcRenderer.invoke('xbox:preloads'),
  setDownloadTotal: (storeId: string, totalBytes: number): Promise<void> =>
    ipcRenderer.invoke('downloads:setTotal', storeId, totalBytes),
  launchPerf: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('perf:launch'),
  getPerfStatus: (): Promise<{ installed: boolean; installDir: string }> => ipcRenderer.invoke('perf:status'),
  installPerf: (): Promise<{ ok: boolean; installDir?: string; error?: string }> => ipcRenderer.invoke('perf:install'),
  checkPerfUpdate: (): Promise<{
    installed: boolean
    updateAvailable: boolean
    embeddedHash: string
    embeddedVersion?: string
    installedVersion?: string
    embeddedDate?: string
    installedDate?: string
  }> => ipcRenderer.invoke('perf:updateCheck'),
  getHdrStatus: (): Promise<{ supported: boolean; enabled: boolean }> => ipcRenderer.invoke('hdr:status'),
  toggleHdr: (): Promise<{ supported: boolean; enabled: boolean }> => ipcRenderer.invoke('hdr:toggle'),
  openHdrSettings: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('hdr:openSettings'),
  openHdrColorMgmt: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('hdr:openColorMgmt'),
  openHdrCalibration: (): Promise<{ ok: boolean; installed: boolean }> => ipcRenderer.invoke('hdr:openCalibration'),
  notify: (title: string, body: string): Promise<void> => ipcRenderer.invoke('app:notify', title, body),
  setHdr: (on: boolean): Promise<{ supported: boolean; enabled: boolean }> =>
    ipcRenderer.invoke(on ? 'hdr:on' : 'hdr:off'),

  testAchievement: (): Promise<void> => ipcRenderer.invoke('debug:testAchievement'),
  overlayIdle: (): void => ipcRenderer.send('overlay:idle'),

  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),

  onSyncProgress: (cb: (p: SyncProgress) => void) => on('sync:progress', cb),
  onLibraryChanged: (cb: () => void) => on('library:changed', cb),
  onAchievementUnlocked: (cb: (e: AchievementUnlockedEvent) => void) => on('achievement:unlocked', cb),
  onGameSession: (cb: (e: GameSessionEvent) => void) => on('game:session', cb),
  onInstallProgress: (cb: (e: InstallProgressEvent) => void) => on('game:installProgress', cb),
  onTraySync: (cb: () => void) => on('tray:sync', cb)
}

export type AllAccessApi = typeof api

contextBridge.exposeInMainWorld('api', api)
