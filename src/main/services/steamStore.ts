import type { SteamPromos, SteamSpecial } from '../../shared/types'

/**
 * Deux sources Steam PUBLIQUES (aucun compte, aucun jeton requis), jamais mélangées :
 *  - Le CATALOGUE : les jeux les plus populaires du store (résultats de recherche par défaut,
 *    sans filtre promo) — l'équivalent Steam du « PC Game Pass » côté Xbox.
 *  - Les PROMOS : « Offre exceptionnelle du jour » (Daily Deal officielle) + « Offres de la
 *    semaine » (liste complète des soldes en cours).
 * Les deux s'appuient sur l'API de recherche publique du store, qui renvoie du HTML qu'on parse
 * (aucune API JSON publique ne liste tout) — filtrée par `specials=1` pour les promos, sans
 * filtre pour le catalogue général.
 */

const FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories/?l=french&cc=FR'
const PROMOS_SEARCH_URL =
  'https://store.steampowered.com/search/results/?query&start=0&count=100&specials=1&infinite=1&cc=FR&l=french'
const CATALOG_SEARCH_URL =
  'https://store.steampowered.com/search/results/?query&start=0&count=100&infinite=1&cc=FR&l=french'
// maxprice=free : filtre officiel du store Steam → uniquement les jeux free-to-play
// (Fortnite, Dota 2, CS2…), pas de simples promos à 100% temporaires.
const FREE_SEARCH_URL =
  'https://store.steampowered.com/search/results/?query&start=0&count=100&maxprice=free&infinite=1&cc=FR&l=french'
const PROMOS_TTL = 3 * 3600_000 // 3h — les promos ne changent pas plus vite que ça
const CATALOG_TTL = 6 * 3600_000 // 6h — le classement des jeux populaires évolue plus lentement
const FREE_TTL = 12 * 3600_000 // 12h — la liste des jeux F2P bouge très rarement

interface RawSpecial {
  id: number
  name: string
  discount_percent: number
  original_price: number
  final_price: number
  currency: string
  header_image?: string
  large_capsule_image?: string
  discount_expiration?: number
}
interface FeaturedCategory {
  id?: string
  items?: RawSpecial[]
}
type FeaturedResponse = Record<string, FeaturedCategory | undefined>

function toSpecial(i: RawSpecial): SteamSpecial {
  return {
    appid: i.id,
    name: i.name,
    discountPercent: i.discount_percent,
    originalPriceCents: i.original_price,
    finalPriceCents: i.final_price,
    currency: i.currency,
    imageUrl: i.header_image || i.large_capsule_image || '',
    expiresAt: i.discount_expiration ?? null,
    free: false
  }
}

/**
 * Parse le HTML de résultats de recherche Steam (aucune API JSON publique ne liste tout).
 * `requireDiscount` : n'inclut que les lignes réellement soldées (mode Promos) ; sinon inclut
 * aussi les jeux à prix plein et gratuits (mode Catalogue).
 */
function parseSearchRows(html: string, requireDiscount: boolean): SteamSpecial[] {
  const out: SteamSpecial[] = []
  const rowRe =
    /<a href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*"[\s\S]*?<\/a>\s*(?=<a href="https:\/\/store\.steampowered\.com\/app\/|$)/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html))) {
    const block = m[0]
    const nameM = block.match(/<span class="title">([^<]+)<\/span>/)
    const imgM = block.match(/<div class="search_capsule"><img src="([^"]+)"/)
    const discM = block.match(/data-discount="(\d+)"/)
    const finalCentsM = block.match(/data-price-final="(\d+)"/)
    const origTxtM = block.match(/<div class="discount_original_price">([^<]+)<\/div>/)
    const isFree = /discount_final_price free"/.test(block)
    if (!nameM) continue
    const discountPercent = discM ? Number(discM[1]) : 0
    if (requireDiscount && discountPercent <= 0) continue
    if (!requireDiscount && !finalCentsM && !isFree) continue // ligne sans prix exploitable (bundle, etc.)
    const finalPriceCents = isFree ? 0 : finalCentsM ? Number(finalCentsM[1]) : 0
    const originalPriceCents = origTxtM
      ? Math.round(parseFloat(origTxtM[1].replace(/[^\d,]/g, '').replace(',', '.')) * 100)
      : finalPriceCents
    out.push({
      appid: Number(m[1]),
      name: nameM[1],
      discountPercent,
      originalPriceCents:
        originalPriceCents || (discountPercent > 0 ? Math.round(finalPriceCents / (1 - discountPercent / 100)) : finalPriceCents),
      finalPriceCents,
      currency: 'EUR',
      imageUrl: imgM ? imgM[1] : '',
      expiresAt: null,
      free: isFree
    })
  }
  return out
}

let promosCache: { fetchedAt: number; data: SteamPromos } | null = null

export async function fetchSteamPromos(): Promise<SteamPromos> {
  if (promosCache && Date.now() - promosCache.fetchedAt < PROMOS_TTL) return promosCache.data

  const [dailyDeal, allSpecials, freeRows] = await Promise.all([
    fetch(FEATURED_URL, { signal: AbortSignal.timeout(15_000) })
      .then((res) => (res.ok ? (res.json() as Promise<FeaturedResponse>) : null))
      .then((body) => {
        if (!body) return null
        const cat = Object.values(body).find((c) => c?.id === 'cat_dailydeal')
        const item = cat?.items?.[0]
        return item ? toSpecial(item) : null
      })
      .catch(() => null),
    fetch(PROMOS_SEARCH_URL, { signal: AbortSignal.timeout(20_000) })
      .then((res) => (res.ok ? (res.json() as Promise<{ results_html?: string }>) : null))
      .then((body) => (body?.results_html ? parseSearchRows(body.results_html, true) : []))
      .catch(() => [] as SteamSpecial[]),
    // Recherche « maxprice=free » : les jeux payants OFFERTS temporairement (‑100 %) y apparaissent
    // gratuits AVEC une réduction, alors que les F2P permanents ont 0 % — c'est ce qui les distingue.
    fetchFreeSearchRows().catch(() => [] as SteamSpecial[])
  ])

  // Un jeu « offert » = normalement payant mais actuellement gratuit à garder : soit une promo à
  // prix final nul, soit une ligne gratuite portant une réduction dans la recherche des gratuits.
  const byId = new Map<number, SteamSpecial>()
  for (const s of allSpecials) if (s.finalPriceCents === 0 || s.free) byId.set(s.appid, s)
  for (const s of freeRows) if (s.discountPercent > 0) byId.set(s.appid, { ...s, free: true })
  if (dailyDeal) byId.delete(dailyDeal.appid) // pas de doublon avec l'offre du jour
  const becomeFree = [...byId.values()].sort((a, b) => b.originalPriceCents - a.originalPriceCents)

  // Promos PAYANTES : soldes dont le prix final reste > 0 (on retire les offerts ci-dessus).
  const paid = allSpecials.filter((s) => s.finalPriceCents > 0 && !s.free)
  paid.sort((a, b) => b.discountPercent - a.discountPercent)
  const weekly = dailyDeal ? paid.filter((s) => s.appid !== dailyDeal.appid) : paid

  const data: SteamPromos = { dailyDeal, weekly, becomeFree }
  // Ne met en cache qu'un résultat non vide : les fetchs avalent leurs erreurs (.catch), donc un
  // échec réseau transitoire produirait « aucune promo » — et l'appli étant résidente (le process
  // ne redémarre jamais), ce vide resterait gelé pendant tout le TTL de 3 h.
  if (dailyDeal || weekly.length > 0 || becomeFree.length > 0) promosCache = { fetchedAt: Date.now(), data }
  return data
}

let catalogCache: { fetchedAt: number; data: SteamSpecial[] } | null = null

/** Catalogue général Steam (jeux les plus populaires) — jamais mélangé aux promos. */
export async function fetchSteamCatalog(): Promise<SteamSpecial[]> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL) return catalogCache.data
  const res = await fetch(CATALOG_SEARCH_URL, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Steam search → HTTP ${res.status}`)
  const body = (await res.json()) as { results_html?: string }
  const data = body.results_html ? parseSearchRows(body.results_html, false) : []
  catalogCache = { fetchedAt: Date.now(), data }
  return data
}

let freeRowsCache: { fetchedAt: number; data: SteamSpecial[] } | null = null

/** Toutes les lignes actuellement GRATUITES du store (maxprice=free), F2P + offerts temporaires. */
async function fetchFreeSearchRows(): Promise<SteamSpecial[]> {
  if (freeRowsCache && Date.now() - freeRowsCache.fetchedAt < FREE_TTL) return freeRowsCache.data
  const res = await fetch(FREE_SEARCH_URL, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Steam search (gratuits) → HTTP ${res.status}`)
  const body = (await res.json()) as { results_html?: string }
  const data = body.results_html ? parseSearchRows(body.results_html, false).filter((s) => s.free) : []
  freeRowsCache = { fetchedAt: Date.now(), data }
  return data
}

/**
 * Jeux Steam réellement free-to-play (Fortnite, Dota 2, CS2…) — SANS réduction : un jeu payant
 * offert temporairement (‑100 %) n'est pas un F2P, il part dans les promos « à garder »
 * (voir fetchSteamPromos → becomeFree).
 */
export async function fetchSteamFreeGames(): Promise<SteamSpecial[]> {
  return (await fetchFreeSearchRows()).filter((s) => s.discountPercent === 0)
}
