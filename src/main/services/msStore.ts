import { getStoreAccess } from './xboxAuth'
import { normalizeName, resolveProducts, type ResolvedProduct } from './gamepass'

/**
 * Achats réels du compte Microsoft via l'API collections du Store
 * (celle qu'utilisent l'app Xbox et le Microsoft Store eux-mêmes).
 * Permet de distinguer un jeu ACHETÉ d'un jeu simplement joué via le Game Pass.
 */

export interface PurchasedGames {
  names: Set<string>
  pfns: Set<string>
  products: ResolvedProduct[]
  /** Le catalogue Store n'a pas pu être résolu intégralement (échec réseau partiel) — la liste peut être incomplète. */
  partial: boolean
}

interface CollectionItem {
  productId?: string
  status?: string
  /** "Single" = achat, "Recurring" = abonnement (Game Pass), "Trial" = essai… */
  acquisitionType?: string
  productKind?: string
}

interface CollectionsResponse {
  items?: CollectionItem[]
  continuationToken?: string
}

let memCache: { fetchedAt: number; data: PurchasedGames } | null = null
let appsCache: { fetchedAt: number; data: ResolvedProduct[] } | null = null

async function queryCollections(): Promise<CollectionItem[]> {
  const { uhs, token } = await getStoreAccess()
  const items: CollectionItem[] = []
  let continuationToken: string | null = null
  do {
    const body: Record<string, unknown> = {
      maxPageSize: 200,
      excludeDuplicates: true,
      validityType: 'All'
    }
    if (continuationToken) body.continuationToken = continuationToken
    const res = await fetch('https://collections.mp.microsoft.com/v7.0/collections/query', {
      method: 'POST',
      headers: {
        Authorization: `XBL3.0 x=${uhs};${token}`,
        'Content-Type': 'application/json',
        'MS-CV': 'gamevault'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000)
    })
    if (!res.ok) throw new Error(`collections → HTTP ${res.status}`)
    const data = (await res.json()) as CollectionsResponse
    items.push(...(data.items ?? []))
    continuationToken = data.continuationToken ?? null
  } while (continuationToken)
  return items
}

/**
 * Liste les jeux réellement achetés (hors abonnement, hors essai).
 * Retourne null si l'API est inaccessible — l'appelant applique alors un fallback.
 */
export async function fetchPurchasedGames(): Promise<PurchasedGames | null> {
  if (memCache && Date.now() - memCache.fetchedAt < 3_600_000) return memCache.data
  try {
    const items = await queryCollections()
    // Achat définitif = droit actif qui ne vient PAS d'un abonnement ni d'un essai
    const purchased = items.filter(
      (i) =>
        i.productId &&
        (i.productKind ?? 'Game') === 'Game' &&
        (i.status ?? 'Active') === 'Active' &&
        !/recurring|trial|sampling|rental|subscription/i.test(i.acquisitionType ?? '')
    )
    const { products, partial } = await resolveProducts([...new Set(purchased.map((i) => i.productId as string))])
    const names = new Set(products.map((p) => normalizeName(p.title)))
    const pfns = new Set(products.flatMap((p) => (p.pfn ? [p.pfn.toLowerCase()] : [])))
    console.log(`[msStore] ${products.length} jeux achetés détectés sur le compte Microsoft`)
    const data: PurchasedGames = { names, pfns, products, partial }
    memCache = { fetchedAt: Date.now(), data }
    return data
  } catch (e) {
    console.warn('[msStore] API collections indisponible :', (e as Error).message)
    return null
  }
}

let addonsCache: { fetchedAt: number; data: ResolvedProduct[] } | null = null

/**
 * Liste les DLC/extensions possédés (produits « Durable ») sur le compte Microsoft.
 * Sert à afficher, sur chaque jeu Xbox, combien de ses DLC l'utilisateur possède.
 * Retourne [] si l'API est indisponible.
 */
export async function fetchOwnedAddons(): Promise<ResolvedProduct[]> {
  if (addonsCache && Date.now() - addonsCache.fetchedAt < 3_600_000) return addonsCache.data
  try {
    const items = await queryCollections()
    const addons = items.filter(
      (i) =>
        i.productId &&
        (i.productKind ?? '') === 'Durable' &&
        (i.status ?? 'Active') === 'Active' &&
        !/recurring|trial|sampling|rental|subscription/i.test(i.acquisitionType ?? '')
    )
    const { products } = await resolveProducts([...new Set(addons.map((i) => i.productId as string))])
    addonsCache = { fetchedAt: Date.now(), data: products }
    return products
  } catch (e) {
    console.warn('[msStore] fetchOwnedAddons indisponible :', (e as Error).message)
    return []
  }
}

/**
 * Liste les applications (hors jeux) possédées sur le compte — Xbox App, Game Bar, etc.
 * Séparées des jeux pour ne pas polluer la bibliothèque. Retourne [] si l'API est indisponible.
 */
export async function fetchPurchasedApps(): Promise<ResolvedProduct[]> {
  if (appsCache && Date.now() - appsCache.fetchedAt < 3_600_000) return appsCache.data
  try {
    const items = await queryCollections()
    const apps = items.filter(
      (i) =>
        i.productId &&
        (i.productKind ?? 'Game') !== 'Game' &&
        (i.status ?? 'Active') === 'Active' &&
        !/recurring|trial|sampling|rental|subscription/i.test(i.acquisitionType ?? '')
    )
    const { products } = await resolveProducts([...new Set(apps.map((i) => i.productId as string))])
    console.log(`[msStore] ${products.length} applications détectées sur le compte Microsoft`)
    appsCache = { fetchedAt: Date.now(), data: products }
    return products
  } catch (e) {
    console.warn('[msStore] fetchPurchasedApps indisponible :', (e as Error).message)
    return []
  }
}
