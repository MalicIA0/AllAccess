import type { AchievementUnlockedEvent, NotifStyle } from '../../shared/types'

/**
 * Page overlay v2 : bannières de succès premium.
 * - couleur pilotée par le tier de rareté + accents du thème
 * - textes en cascade, anneau rotatif, sweep, particules pour épique/légendaire
 * - carillon synthétisé (WebAudio) — arpège plus riche selon la rareté
 */

const THEME_ACCENTS: Record<string, [string, string]> = {
  nebula: ['#8b5cf6', '#22d3ee'],
  rubis: ['#ef4444', '#fb923c'],
  emeraude: ['#10b981', '#a3e635'],
  minuit: ['#3b82f6', '#7dd3fc'],
  crepuscule: ['#f97316', '#ec4899'],
  ornoir: ['#b8860b', '#d4af37'],
  mono: ['#737373', '#d4d4d4'],
  synthwave: ['#f472b6', '#38bdf8'],
  sakura: ['#fb7185', '#fbcfe8'],
  glacier: ['#38bdf8', '#e0f2fe'],
  foret: ['#4ade80', '#fbbf24'],
  royal: ['#6366f1', '#f59e0b'],
  neon: ['#00ff88', '#ff2ec4'],
  volcan: ['#ff4d00', '#fbbf24'],
  cyber: ['#fde047', '#22d3ee'],
  abysse: ['#06b6d4', '#818cf8'],
  toxique: ['#a3e635', '#c084fc'],
  vapeur: ['#c084fc', '#5eead4']
}

interface TierInfo {
  label: string
  color: string
  rank: number
}

function tierFor(rarity: number | null): TierInfo {
  if (rarity == null) return { label: 'SUCCÈS', color: '#8a8aa8', rank: 0 }
  if (rarity >= 50) return { label: 'COMMUN', color: '#34d399', rank: 1 }
  if (rarity >= 20) return { label: 'PEU COMMUN', color: '#22d3ee', rank: 2 }
  if (rarity >= 10) return { label: 'RARE', color: '#a78bfa', rank: 3 }
  if (rarity >= 5) return { label: 'ÉPIQUE', color: '#e879f9', rank: 4 }
  return { label: 'LÉGENDAIRE', color: '#fbbf24', rank: 5 }
}

// Durée d'affichage : réglable dans les Réglages (notifDurationSec, 3–30 s).
// « plein » assombrit tout l'écran (gênant en jeu) → plafonné à 6 s quel que soit le réglage.
const DEFAULT_DURATION_SEC = 10
const MAX_BY_STYLE: Partial<Record<NotifStyle, number>> = { plein: 6000 }
const EXIT_MS = 550

const stage = document.getElementById('stage')!
const queue: AchievementUnlockedEvent[] = []
let busy = false

window.api.onAchievementUnlocked((e) => {
  queue.push(e)
  if (!busy) void next()
})

async function next(): Promise<void> {
  const item = queue.shift()
  if (!item) {
    busy = false
    window.api.overlayIdle()
    return
  }
  busy = true

  let accents = THEME_ACCENTS.nebula
  let notifStyle: NotifStyle = 'banniere'
  let durationSec = DEFAULT_DURATION_SEC
  try {
    const s = await window.api.getSettings()
    accents = THEME_ACCENTS[s.theme] ?? THEME_ACCENTS.nebula
    notifStyle = s.notifStyle ?? 'banniere'
    durationSec = s.notifDurationSec ?? DEFAULT_DURATION_SEC
  } catch {
    /* défauts */
  }
  // pilote la mise en page CSS de la bannière (banniere / toast / cinema)
  document.body.dataset.notif = notifStyle

  const a = item.achievement
  const tier = tierFor(a.rarity)

  const banner = document.createElement('div')
  banner.className = `banner t${tier.rank}`
  banner.style.setProperty('--a1', accents[0])
  banner.style.setProperty('--a2', accents[1])
  banner.style.setProperty('--tc', tier.color)

  const hasProgress = item.unlockedCount != null && item.totalCount != null && item.totalCount > 0
  const pct = hasProgress ? Math.round((item.unlockedCount! / item.totalCount!) * 100) : 0

  banner.innerHTML = `
    <div class="sheen"></div>
    <div class="iconwrap">
      <div class="ring"></div>
      <div class="iconbox">${a.iconUrl ? `<img src="${encodeURI(a.iconUrl)}" alt="" />` : '🏆'}</div>
    </div>
    <div class="txt">
      <div class="kicker">SUCCÈS DÉBLOQUÉ <span class="tierchip">${tier.label}</span></div>
      <div class="name"></div>
      <div class="desc"></div>
    </div>
    <div class="meta">
      <div class="game"></div>
      ${a.rarity != null ? `<div class="rarity">${a.rarity < 5 ? '💎 ' : ''}${a.rarity.toFixed(1)}%</div>` : ''}
      ${
        hasProgress
          ? `<div class="progress"><div class="count">${item.unlockedCount}/${item.totalCount} · ${pct}%</div><div class="bar"><div class="fill" style="width:${pct}%"></div></div></div>`
          : ''
      }
    </div>`
  // textes injectés en textContent (jamais interprétés comme HTML)
  banner.querySelector('.name')!.textContent = a.name
  banner.querySelector('.desc')!.textContent = a.description || ''
  banner.querySelector('.game')!.textContent = item.gameName

  // STICKER : deux instants clés, et il faut brancher chaque effet sur le bon.
  //  - 0,40 s : le ROULEAU percute la vitre (secousse, poussière, anneau de choc)
  //  - 1,12 s : la dernière bande sort du rouleau, la carte est complète — c'est seulement là que
  //    l'icône existe, donc les effets qui partent d'elle doivent attendre (sinon ils jaillissent
  //    d'une zone encore masquée par le clip-path).
  const isSticker = notifStyle === 'sticker'
  const impactAt = isSticker ? 0.4 : 0
  const iconAt = isSticker ? 1.12 : 0

  // onde de choc depuis l'icône pour épique / légendaire (double pour le légendaire)
  if (tier.rank >= 4) {
    const shocks = tier.rank === 5 ? 2 : 1
    for (let i = 0; i < shocks; i++) {
      const s = document.createElement('span')
      s.className = 'shock'
      s.style.animationDelay = isSticker ? `${iconAt + i * 0.22}s` : `${0.35 + i * 0.28}s`
      banner.appendChild(s)
    }
  }

  // particules pour épique / légendaire (sauf en mode feu d'artifice, qui a ses propres gerbes)
  if (tier.rank >= 4 && notifStyle !== 'feuartifice') {
    const n = tier.rank === 5 ? 26 : 12
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span')
      p.className = 'particle'
      // particules aux deux accents du thème — l'or s'invite pour le légendaire
      p.style.setProperty(
        '--pc',
        tier.rank === 5 && i % 3 === 0 ? '#fbbf24' : i % 2 === 0 ? accents[0] : accents[1]
      )
      const angle = Math.random() * Math.PI * 2
      const dist = 60 + Math.random() * 90
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
      p.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.7}px`)
      p.style.animationDelay = `${(isSticker ? iconAt : 0) + 0.25 + Math.random() * 0.35}s`
      p.style.width = p.style.height = `${3 + Math.random() * 5}px`
      banner.appendChild(p)
    }
  }

  // FEU D'ARTIFICE : quelques gerbes discrètes qui éclatent au-dessus de la bannière, en séquence
  if (notifStyle === 'feuartifice') {
    // plus de gerbes pour les succès rares, mais toujours discret
    const bursts = tier.rank >= 4 ? 4 : 3
    for (let b = 0; b < bursts; b++) {
      const ox = 18 + Math.random() * 64 // % de largeur de la bannière
      const oy = -8 - Math.random() * 26 // px au-dessus du bord haut
      const burstColor = b % 2 === 0 ? accents[0] : accents[1]
      const sparks = 9 + Math.floor(Math.random() * 4)
      const baseDelay = 0.15 + b * 0.42 // gerbes en cascade
      for (let i = 0; i < sparks; i++) {
        const s = document.createElement('span')
        s.className = 'fw'
        // une étincelle blanche de temps en temps pour l'éclat
        s.style.setProperty('--pc', i % 5 === 0 ? '#ffffff' : burstColor)
        s.style.setProperty('--ox', `${ox}%`)
        s.style.setProperty('--oy', `${oy}px`)
        const angle = (i / sparks) * Math.PI * 2 + Math.random() * 0.5
        const dist = 34 + Math.random() * 40
        s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`)
        s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`)
        s.style.setProperty('--dur', `${0.85 + Math.random() * 0.4}s`)
        s.style.setProperty('--delay', `${baseDelay + Math.random() * 0.1}s`)
        s.style.width = s.style.height = `${3 + Math.random() * 3}px`
        banner.appendChild(s)
      }
    }
  }

  // STICKER : la bannière est emballée dans une couche porteuse qui joue la TRAJECTOIRE. Le
  // ROULEAU et l'anneau de choc sont ses frères, pas ses enfants : la bannière est découpée au
  // clip-path pendant tout le dévidage, donc tout ce qui doit rester visible avant la fin doit
  // vivre EN DEHORS d'elle — sinon c'est masqué avec le reste.
  let mounted: HTMLElement = banner
  if (isSticker) {
    const wrap = document.createElement('div')
    wrap.className = 'stickerwrap'
    // les variables de couleur vivent sur le porteur : l'anneau de choc et la poussière en ont
    // besoin aussi, et la bannière continue de les recevoir par héritage
    wrap.style.setProperty('--a1', accents[0])
    wrap.style.setProperty('--a2', accents[1])
    wrap.style.setProperty('--tc', tier.color)

    const ring = document.createElement('span')
    ring.className = 'slapring'
    const roll = document.createElement('span')
    roll.className = 'roll'
    wrap.append(ring, banner, roll)

    // poussière chassée par le choc du rouleau : elle part donc du BORD DROIT, là où il percute
    for (let i = 0; i < 16; i++) {
      const d = document.createElement('span')
      d.className = 'dust'
      d.style.setProperty('--pc', i % 4 === 0 ? 'rgba(255,255,255,0.9)' : i % 2 === 0 ? accents[0] : accents[1])
      const bottom = i % 2 === 0
      d.style.setProperty('--px', `${86 + Math.random() * 14}%`)
      d.style.setProperty('--py', bottom ? '100%' : '0%')
      d.style.setProperty('--dx', `${8 + Math.random() * 66}px`) // vers l'extérieur = vers la droite
      d.style.setProperty('--dy', `${(bottom ? 1 : -1) * (6 + Math.random() * 24)}px`)
      d.style.animationDelay = `${impactAt + Math.random() * 0.05}s`
      d.style.width = d.style.height = `${2 + Math.random() * 3.5}px`
      wrap.appendChild(d)
    }
    mounted = wrap
  }

  stage.replaceChildren(mounted)
  // La secousse du sticker est portée par #stage, qui n'est PAS recréé entre deux succès :
  // sans ce reset, le choc ne serait secoué qu'à la toute première notification de la session.
  if (isSticker) {
    stage.style.animation = 'none'
    void stage.offsetWidth // force le reflow → l'animation repart de zéro
    stage.style.animation = ''
  }
  // NB : le son (WebAudio) est joué par la fenêtre PRINCIPALE, pas ici — créer un AudioContext
  // dans cette fenêtre overlay (transparente, non-focusable, always-on-top) fait planter son
  // processus de rendu et la bannière disparaît aussitôt. L'overlay ne fait donc que le visuel.

  // le légendaire mérite un court sursis (mais le Cinéma reste bref)
  const baseMs = Math.min(
    Math.min(Math.max(durationSec, 3), 30) * 1000,
    MAX_BY_STYLE[notifStyle] ?? Number.POSITIVE_INFINITY
  )
  const legendaryBonus = notifStyle === 'cinema' ? 500 : 1200
  await sleep(tier.rank >= 5 ? baseMs + legendaryBonus : baseMs)
  banner.classList.add('out')
  await sleep(EXIT_MS)
  mounted.remove() // en mode sticker, retire aussi la couche porteuse et l'anneau de choc
  void next()
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
