import type { XboxDeal } from '../../shared/types'

/**
 * Promos du Store Xbox (page publique « Offres sur les jeux » de xbox.com, aucun compte requis).
 * La page embarque son état en JSON (`window.__PRELOADED_STATE__`) : la première page de 25 offres
 * y est rendue côté serveur, puis on enchaîne les pages suivantes via l'API xboxcomfd/browse
 * (celle du bouton « Charger plus » du site) avec le jeton de continuation.
 * NB : l'ancienne API publique reco-public.rec.mp.microsoft.com n'existe plus (DNS mort) et les
 * collections StoreEdgeFD renvoient systématiquement 0 résultat — le scraping est la seule voie.
 */

const DEALS_PAGE_URL = 'https://www.xbox.com/fr-FR/games/browse/DynamicChannel.GameDeals'
const BROWSE_API_URL = 'https://emerald.xboxservices.com/xboxcomfd/browse?locale=fr-FR'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const DEALS_TTL = 3 * 3600_000 // 3h — même rythme que les promos Steam
const MAX_PAGES = 4 // 4 × 25 ≈ 100 offres, comme la liste Steam

interface StoreImage {
  url?: string
}
interface StorePrice {
  discountPercentage?: number
  listPrice?: number
  msrp?: number
  currency?: string
  endDateUtc?: string
}
interface ProductSummary {
  productId?: string
  title?: string
  availableOn?: string[]
  images?: { poster?: StoreImage; boxArt?: StoreImage; titledHeroArt?: StoreImage }
  specificPrices?: { purchaseable?: StorePrice[] }
}
interface ChannelData {
  products?: { productId?: string }[]
  encodedCT?: string
}
interface BrowseResponse {
  channels?: Record<string, { data?: ChannelData } & ChannelData>
  productSummaries?: Record<string, ProductSummary> | ProductSummary[]
}

/**
 * Extrait le JSON `window.__PRELOADED_STATE__ = {…}` du HTML par équilibrage d'accolades —
 * le JSON contient lui-même des `};` internes, un regex non-gourmand coupe trop tôt.
 */
function extractPreloadedState(html: string): Record<string, unknown> | null {
  const at = html.indexOf('window.__PRELOADED_STATE__')
  if (at < 0) return null
  const start = html.indexOf('{', at)
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (esc) {
      esc = false
      continue
    }
    if (inStr) {
      if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function toDeal(summary: ProductSummary): XboxDeal | null {
  const price = summary.specificPrices?.purchaseable?.[0]
  if (!summary.productId || !summary.title || !price) return null
  const discountPercent = Math.round(price.discountPercentage ?? 0)
  if (discountPercent <= 0) return null
  const finalPriceCents = Math.round((price.listPrice ?? 0) * 100)
  const originalPriceCents = Math.round((price.msrp ?? price.listPrice ?? 0) * 100)
  const expiresMs = price.endDateUtc ? Date.parse(price.endDateUtc) : NaN
  const available = summary.availableOn ?? []
  const imageUrl = summary.images?.poster?.url ?? summary.images?.boxArt?.url ?? summary.images?.titledHeroArt?.url
  return {
    productId: summary.productId,
    title: summary.title,
    discountPercent,
    originalPriceCents,
    finalPriceCents,
    currency: price.currency ?? 'EUR',
    // les images du Store acceptent un redimensionnement par query — inutile de charger du 2160px
    imageUrl: imageUrl ? `${imageUrl}?w=600` : '',
    expiresAt: Number.isNaN(expiresMs) ? null : Math.round(expiresMs / 1000),
    pc: available.includes('PC'),
    console: available.includes('XboxOne') || available.includes('XboxSeriesX')
  }
}

/** Ajoute les offres d'une page dans `out` en respectant l'ordre du channel (tri du site). */
function collectPage(
  channel: ChannelData | undefined,
  summaries: Record<string, ProductSummary> | ProductSummary[] | undefined,
  out: Map<string, XboxDeal>
): void {
  if (!channel?.products || !summaries) return
  // la page SSR indexe les résumés par productId, l'API browse renvoie un simple tableau —
  // on ré-indexe par productId pour traiter les deux formats pareil
  const byId = new Map<string, ProductSummary>()
  for (const s of Array.isArray(summaries) ? summaries : Object.values(summaries)) {
    if (s?.productId) byId.set(s.productId, s)
  }
  for (const { productId } of channel.products) {
    if (!productId || out.has(productId)) continue
    const summary = byId.get(productId)
    if (!summary) continue
    const deal = toDeal(summary)
    if (deal) out.set(productId, deal)
  }
}

let dealsCache: { fetchedAt: number; data: XboxDeal[] } | null = null

export async function fetchXboxDeals(): Promise<XboxDeal[]> {
  if (dealsCache && Date.now() - dealsCache.fetchedAt < DEALS_TTL) return dealsCache.data

  const out = new Map<string, XboxDeal>()
  let channelKey = ''
  let encodedCT: string | null = null

  // Page 1 : rendue côté serveur dans le HTML de la page publique
  try {
    const res = await fetch(DEALS_PAGE_URL, {
      headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9' },
      signal: AbortSignal.timeout(20_000)
    })
    if (res.ok) {
      const state = extractPreloadedState(await res.text())
      const core2 = state?.core2 as
        | { channels?: { channelData?: Record<string, { data?: ChannelData }> }; products?: { productSummaries?: Record<string, ProductSummary> } }
        | undefined
      const channelEntries = Object.entries(core2?.channels?.channelData ?? {})
      if (channelEntries.length > 0) {
        const [key, ch] = channelEntries[0]
        channelKey = key
        collectPage(ch.data, core2?.products?.productSummaries, out)
        encodedCT = ch.data?.encodedCT ?? null
      }
    }
  } catch {
    /* réseau — on tente quand même le cache ci-dessous */
  }

  // Pages suivantes : la même API que le bouton « Charger plus » du site
  for (let page = 2; page <= MAX_PAGES && encodedCT && channelKey; page++) {
    try {
      const res = await fetch(BROWSE_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': UA,
          'ms-cv': 'gamevault.0',
          // sans ce header l'API répond UnsupportedApiVersion
          'x-ms-api-version': '1.1'
        },
        body: JSON.stringify({
          Filters: 'e30=',
          ReturnFilters: false,
          ChannelKeyToBeUsedInResponse: channelKey,
          BrowseChannelId: 'DYNAMICCHANNEL.GAMEDEALS',
          EncodedCT: encodedCT
        }),
        signal: AbortSignal.timeout(20_000)
      })
      if (!res.ok) break
      const data = (await res.json()) as BrowseResponse
      // la page SSR enveloppe le channel dans `data`, l'API le renvoie à plat — on gère les deux
      const chResp = data.channels?.[channelKey]
      const channel = chResp?.data ?? chResp
      collectPage(channel, data.productSummaries, out)
      encodedCT = channel?.encodedCT ?? null
    } catch {
      break
    }
  }

  const deals = [...out.values()]
  // Ne met en cache qu'un résultat non vide : un échec transitoire ne doit pas geler
  // « aucune promo » pendant 3 h (l'appli résidente ne redémarre jamais le process).
  if (deals.length > 0) dealsCache = { fetchedAt: Date.now(), data: deals }
  return deals
}
