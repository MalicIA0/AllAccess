import type { ChimeStyle } from '../../../shared/types'

/**
 * Carillons de succès synthétisés (WebAudio) — neuf timbres au choix.
 * Partagé entre l'overlay (bannière de succès) et les Réglages (boutons d'écoute).
 * `rank` 0→5 = rareté (Commun→Légendaire) : plus c'est rare, plus le son est riche/long.
 * `volume` 0→1.
 */

let ctx: AudioContext | null = null
function audio(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

function tone(
  c: AudioContext,
  master: GainNode,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  peak: number,
  glideTo?: number
): void {
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0, start)
  g.gain.linearRampToValueAtTime(peak, start + Math.min(0.02, dur * 0.2))
  g.gain.exponentialRampToValueAtTime(0.0008, start + dur)
  osc.connect(g)
  g.connect(master)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

/** Cristal — carillon clair et chaud (cloches sinus + octave). */
function cristal(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const scale = [523.25, 659.25, 783.99, 1046.5, 1318.5] // C5 E5 G5 C6 E6
  const notes = rank >= 5 ? scale : rank === 4 ? scale.slice(0, 4) : rank === 3 ? scale.slice(0, 3) : [scale[1], scale[3]]
  notes.forEach((f, i) => {
    const t = now + i * 0.085
    tone(c, master, 'sine', f, t, 1.15, 1)
    tone(c, master, 'sine', f * 2, t, 1.1, 0.28)
  })
  if (rank >= 5) {
    const t = now + notes.length * 0.085 + 0.05
    tone(c, master, 'triangle', 2093, t, 0.7, 0.5, 3136)
  }
}

/** Arcade — bips 8-bit ascendants facon power-up rétro. */
function arcade(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const base = [392, 523.25, 659.25, 783.99, 1046.5] // G4 C5 E5 G5 C6
  const steps = rank >= 5 ? base : rank >= 3 ? base.slice(0, 4) : base.slice(0, 3)
  steps.forEach((f, i) => {
    const t = now + i * 0.07
    tone(c, master, 'square', f, t, 0.11, 0.5)
    tone(c, master, 'square', f * 1.5, t, 0.09, 0.16) // quinte pour l'épaisseur chiptune
  })
  // petit glissando final facon "1-up"
  const tEnd = now + steps.length * 0.07
  tone(c, master, 'square', steps[steps.length - 1], tEnd, 0.16, 0.4, steps[steps.length - 1] * 2)
}

/** Cinématique — impact grave + nappe montante, dramatique. */
function cinematique(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  // sub-boom d'impact
  tone(c, master, 'sine', 110, now, 0.9, 0.9, 55)
  tone(c, master, 'triangle', 165, now, 0.7, 0.4, 82)
  // accord majeur soutenu (nappe)
  const chord = [261.63, 329.63, 392.0] // C4 E4 G4
  chord.forEach((f) => {
    tone(c, master, 'sawtooth', f, now + 0.08, 1.6, 0.12)
    tone(c, master, 'sine', f * 2, now + 0.08, 1.5, 0.08)
  })
  // éclat aigu qui monte pour les hauts rangs
  if (rank >= 4) tone(c, master, 'sine', 784, now + 0.5, 1.1, 0.18, 1568)
  if (rank >= 5) tone(c, master, 'triangle', 1046, now + 0.7, 1.0, 0.16, 2093)
}

/** Cloche — grand carillon d'église : partiels inharmoniques, longue résonance. */
function cloche(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const fund = 261.63 // C4
  const partials = [1, 2.0, 2.4, 3.0, 4.5, 5.33] // rapports typiques d'une cloche (inharmoniques)
  const gains = [1, 0.5, 0.35, 0.28, 0.16, 0.1]
  partials.forEach((p, i) => tone(c, master, 'sine', fund * p, now, 2.3, gains[i] * 0.9))
  // deuxième frappe une quinte au-dessus pour les rangs élevés
  if (rank >= 4) {
    const t = now + 0.55
    partials.forEach((p, i) => tone(c, master, 'sine', fund * 1.5 * p, t, 2.0, gains[i] * 0.65))
  }
  if (rank >= 5) tone(c, master, 'sine', fund * 4, now + 1.05, 1.7, 0.2)
}

/** Harpe — arpège cristallin ascendant, cordes pincées douces. */
function harpe(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const scale = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5] // arpège Do majeur
  const count = rank >= 5 ? 7 : rank >= 4 ? 6 : rank >= 3 ? 5 : 4
  for (let i = 0; i < count; i++) {
    const t = now + i * 0.06
    tone(c, master, 'triangle', scale[i], t, 0.95, 0.5)
    tone(c, master, 'sine', scale[i] * 2, t, 0.55, 0.12) // octave scintillante
  }
}

/** Fanfare — cuivres triomphants (ta-ta-taaa) façon victoire. */
function fanfare(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const seq = [
    { f: 392.0, t: 0, d: 0.14 }, // G4
    { f: 392.0, t: 0.16, d: 0.14 },
    { f: 523.25, t: 0.32, d: 0.55 } // C5 tenu
  ]
  seq.forEach(({ f, t, d }) => {
    tone(c, master, 'sawtooth', f, now + t, d, 0.3)
    tone(c, master, 'sawtooth', f * 1.004, now + t, d, 0.2) // léger désaccord = épaisseur cuivre
    tone(c, master, 'triangle', f / 2, now + t, d, 0.14) // grave de soutien
  })
  // accord majeur final pour les hauts rangs
  if (rank >= 4) [523.25, 659.25, 783.99].forEach((f) => tone(c, master, 'sawtooth', f, now + 0.32, 0.9, 0.15))
  if (rank >= 5) tone(c, master, 'sawtooth', 1046.5, now + 0.55, 0.7, 0.2, 1568)
}

/** Zen — bol tibétain : sinus pur avec battements lents, très apaisant. */
function zen(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const base = 220 // A3
  tone(c, master, 'sine', base, now, 2.8, 0.7)
  tone(c, master, 'sine', base * 2.01, now, 2.6, 0.3) // battement doux (léger désaccord)
  tone(c, master, 'sine', base * 3.02, now, 2.2, 0.14)
  if (rank >= 3) tone(c, master, 'sine', base * 4, now + 0.3, 2.0, 0.1)
  if (rank >= 5) tone(c, master, 'sine', base * 6, now + 0.6, 1.6, 0.08)
}

/** Laser — zap sci-fi : balayages de fréquence montants/descendants. */
function laser(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  tone(c, master, 'sawtooth', 220, now, 0.25, 0.4, 1760) // zap montant
  tone(c, master, 'square', 330, now + 0.05, 0.2, 0.2, 2200)
  if (rank >= 3) tone(c, master, 'sawtooth', 880, now + 0.24, 0.3, 0.32, 110) // redescente
  if (rank >= 4) tone(c, master, 'square', 660, now + 0.42, 0.25, 0.28, 3520)
  if (rank >= 5) tone(c, master, 'sawtooth', 1320, now + 0.58, 0.4, 0.3, 60)
}

/** Magie — pluie d'étincelles aiguës, baguette enchantée. */
function magie(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const notes = [1046.5, 1318.5, 1568.0, 2093.0, 2637.0] // C6 E6 G6 C7 E7
  const count = rank >= 5 ? 5 : rank >= 3 ? 4 : 3
  for (let i = 0; i < count; i++) {
    const t = now + i * 0.05
    tone(c, master, 'triangle', notes[i], t, 0.7, 0.38)
    tone(c, master, 'sine', notes[i] * 1.5, t, 0.5, 0.13)
  }
  // gerbe finale d'étincelles pour les hauts rangs
  if (rank >= 4) {
    for (let i = 0; i < 4; i++) tone(c, master, 'sine', 2000 + i * 500, now + 0.3 + i * 0.04, 0.4, 0.15)
  }
}

/** Pièce — pièce ramassée facon plateforme rétro (deux bips 8-bit rapides, montants). */
function piece(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  tone(c, master, 'square', 987.77, now, 0.08, 0.5) // B5 bref
  tone(c, master, 'square', 1318.51, now + 0.08, 0.5, 0.5) // E6 tenu
  if (rank >= 3) tone(c, master, 'square', 1567.98, now + 0.22, 0.45, 0.3) // G6
  if (rank >= 5) tone(c, master, 'square', 2093, now + 0.36, 0.4, 0.3, 2637) // eclat final
}

/** Digital — notification moderne, epuree : cloches de verre douces (marimba/glass). */
function digital(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const notes = [880, 1174.66] // A5, D6
  notes.forEach((f, i) => {
    const t = now + i * 0.09
    tone(c, master, 'sine', f, t, 0.5, 0.85)
    tone(c, master, 'triangle', f * 2, t, 0.32, 0.12)
  })
  if (rank >= 4) tone(c, master, 'sine', 1760, now + 0.22, 0.5, 0.3) // A6
  if (rank >= 5) tone(c, master, 'sine', 2349.32, now + 0.32, 0.45, 0.22) // D7 scintillant
}

/** Gong — grand gong metallique grave : partiels inharmoniques, tres longue resonance. */
function gong(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const fund = 130.81 // C3
  const partials = [1, 1.48, 2.11, 2.9, 3.9]
  const gains = [1, 0.6, 0.4, 0.25, 0.15]
  partials.forEach((p, i) => tone(c, master, i < 2 ? 'sine' : 'triangle', fund * p, now, 3.0, gains[i] * 0.9))
  tone(c, master, 'sawtooth', fund * 2, now, 0.6, 0.12, fund * 1.5) // balayage metallique d'attaque
  if (rank >= 4) tone(c, master, 'sine', fund * 6, now + 0.4, 2.0, 0.1)
  if (rank >= 5) partials.forEach((p, i) => tone(c, master, 'sine', fund * 1.5 * p, now + 0.7, 2.2, gains[i] * 0.5))
}

/** Choeur — voix « aah » majestueuses : accord large, battements doux facon nappe vocale. */
function choeur(c: AudioContext, master: GainNode, rank: number): void {
  const now = c.currentTime
  const chord = rank >= 4 ? [261.63, 329.63, 392.0, 523.25] : [261.63, 329.63, 392.0] // Do majeur elargi
  chord.forEach((f) => {
    tone(c, master, 'triangle', f, now, 1.8, 0.22)
    tone(c, master, 'sine', f, now, 1.9, 0.3)
    tone(c, master, 'sine', f * 2.01, now, 1.6, 0.1) // leger desaccord = epaisseur vocale
  })
  if (rank >= 5)
  {
    tone(c, master, 'triangle', 1046.5, now + 0.4, 1.5, 0.16)
    tone(c, master, 'sine', 1568, now + 0.6, 1.3, 0.1)
  }
}

const STYLES: Record<ChimeStyle, (c: AudioContext, m: GainNode, rank: number) => void> = {
  cristal,
  arcade,
  cinematique,
  cloche,
  harpe,
  fanfare,
  zen,
  laser,
  magie,
  piece,
  digital,
  gong,
  choeur
}

const BASE_GAIN: Record<ChimeStyle, number> = {
  cristal: 0.27,
  arcade: 0.22,
  cinematique: 0.32,
  cloche: 0.3,
  harpe: 0.26,
  fanfare: 0.24,
  zen: 0.34,
  laser: 0.22,
  magie: 0.24,
  piece: 0.24,
  digital: 0.26,
  gong: 0.32,
  choeur: 0.3
}

/**
 * Sonnette de mise à jour — timbre EXCLUSIF « ding-dong » réservé à cette alerte.
 * Volontairement indépendant des réglages (style, volume, notifSound) : le son
 * et le volume sont fixes et non désactivables, pour que l'alerte reste reconnaissable.
 */
export function playUpdateAlarm(): void {
  try {
    const c = audio()
    if (c.state === 'suspended') void c.resume()
    const master = c.createGain()
    master.gain.value = 0.3
    master.connect(c.destination)
    const now = c.currentTime
    // double « ding-dong » de sonnette (E5 → C#5, avec octave scintillante)
    for (const off of [0, 0.95]) {
      tone(c, master, 'sine', 659.25, now + off, 0.55, 1)
      tone(c, master, 'sine', 1318.5, now + off, 0.4, 0.25)
      tone(c, master, 'sine', 554.37, now + off + 0.38, 0.85, 0.9)
      tone(c, master, 'sine', 1108.73, now + off + 0.38, 0.55, 0.2)
    }
  } catch {
    /* audio indisponible */
  }
}

export function playChime(style: ChimeStyle, rank: number, volume = 0.6): void {
  if (volume <= 0) return
  try {
    const c = audio()
    if (c.state === 'suspended') void c.resume()
    const master = c.createGain()
    master.gain.value = (BASE_GAIN[style] ?? 0.27) * volume
    master.connect(c.destination)
    ;(STYLES[style] ?? cristal)(c, master, rank)
  } catch {
    /* audio indisponible */
  }
}
