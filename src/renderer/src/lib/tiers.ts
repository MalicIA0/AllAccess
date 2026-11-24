/**
 * Tiers de défi, basés sur la rareté mondiale du succès (% de joueurs qui l'ont).
 * Plus c'est rare, plus c'est prestigieux — code couleur façon loot.
 */

export interface Tier {
  label: string
  /** classes du chip */
  chip: string
  /** bordure gauche de la ligne */
  border: string
  /** lueur de fond subtile */
  glow: string
  rank: number
}

export function tierFor(rarity: number | null): Tier {
  if (rarity == null)
    return {
      label: 'Défi',
      chip: 'bg-white/10 text-vault-muted',
      border: 'border-l-vault-border',
      glow: '',
      rank: 0
    }
  if (rarity >= 50)
    return {
      label: 'Commun',
      chip: 'bg-emerald-500/15 text-emerald-300',
      border: 'border-l-emerald-400/70',
      glow: '',
      rank: 1
    }
  if (rarity >= 20)
    return {
      label: 'Peu commun',
      chip: 'bg-cyan-500/15 text-cyan-300',
      border: 'border-l-cyan-400/70',
      glow: '',
      rank: 2
    }
  if (rarity >= 10)
    return {
      label: 'Rare',
      chip: 'bg-violet-500/20 text-violet-300',
      border: 'border-l-violet-400/80',
      glow: 'shadow-[inset_0_0_24px_rgba(139,92,246,0.07)]',
      rank: 3
    }
  if (rarity >= 5)
    return {
      label: 'Épique',
      chip: 'bg-fuchsia-500/20 text-fuchsia-300',
      border: 'border-l-fuchsia-400/80',
      glow: 'shadow-[inset_0_0_24px_rgba(217,70,239,0.09)]',
      rank: 4
    }
  return {
    label: 'Légendaire',
    chip: 'bg-amber-400/20 text-amber-300',
    border: 'border-l-amber-400/90',
    glow: 'shadow-[inset_0_0_28px_rgba(251,191,36,0.12)]',
    rank: 5
  }
}

export const TIER_LEGEND: { label: string; dot: string; range: string }[] = [
  { label: 'Commun', dot: 'bg-emerald-400', range: '≥ 50 %' },
  { label: 'Peu commun', dot: 'bg-cyan-400', range: '20–50 %' },
  { label: 'Rare', dot: 'bg-violet-400', range: '10–20 %' },
  { label: 'Épique', dot: 'bg-fuchsia-400', range: '5–10 %' },
  { label: 'Légendaire', dot: 'bg-amber-400', range: '< 5 %' }
]
