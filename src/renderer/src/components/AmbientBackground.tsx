import { useEffect, useRef } from 'react'
import type { BgMode } from '../../../shared/types'

/**
 * Fond animé premium — moteur canvas multi-styles, entièrement piloté par le thème
 * (les couleurs sont lues sur les variables CSS d'accent et mises à jour en direct sans
 * jamais relancer l'animation). Une seule boucle requestAnimationFrame, mise en pause
 * quand l'onglet est caché, aucune interaction souris.
 */

const CANVAS_MODES: BgMode[] = [
  'halos-particules',
  'constellation',
  'aurore',
  'grille',
  'orbes',
  'meteores',
  'lucioles',
  'vortex',
  'flux'
]

/* ---------- rendus GPU : fragment shaders GLSL exécutés par la carte graphique ---------- */

const SHADER_MODES: BgMode[] = ['nebuleuse', 'plasma', 'liquide']

/** Rendu interne réduit pour les shaders organiques (flou naturel + économie GPU), étiré par le CSS. */
const SHADER_SCALE = 0.7

const VERT_SRC = 'attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }'

/** Bruit de valeur + FBM — la boîte à outils classique des shaders procéduraux. */
const GLSL_LIB = `
precision mediump float;
uniform float u_time;
uniform vec2 u_res;
uniform vec3 u_bg;
uniform vec3 u_c1;
uniform vec3 u_c2;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
`

const FRAG_SRC: Partial<Record<BgMode, string>> = {
  // Nébuleuse : nuages fractals superposés + poussière d'étoiles scintillante
  nebuleuse: `
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res.xy) / u_res.y;
  float t = u_time * 0.1;
  float n1 = fbm(p * 2.2 + vec2(t * 0.6, -t * 0.4));
  float n2 = fbm(p * 3.1 - vec2(t * 0.3, t * 0.5) + n1);
  float neb = smoothstep(0.35, 0.95, n1 * 0.65 + n2 * 0.55);
  vec3 col = u_bg;
  col += u_c1 * neb * 0.5;
  col += u_c2 * smoothstep(0.55, 1.0, n2) * 0.4;
  vec2 sp = floor(gl_FragCoord.xy / 2.5);
  float star = step(0.9975, hash(sp));
  float tw = 0.5 + 0.5 * sin(u_time * (1.0 + hash(sp + 7.0) * 3.0) + hash(sp) * 6.2831);
  col += vec3(1.0) * star * tw * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`,
  // Plasma : ondes sinus entrelacées, l'effet démo-scène par excellence
  plasma: `
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res.xy) / u_res.y;
  float t = u_time * 0.35;
  float v = sin(p.x * 3.0 + t);
  v += sin((p.y * 4.0 + t) * 0.8);
  v += sin((p.x + p.y) * 3.0 + t * 1.2);
  vec2 c = p + vec2(sin(t * 0.5), cos(t * 0.3));
  v += sin(length(c) * 5.0 - t);
  v *= 0.25;
  float m1 = 0.5 + 0.5 * sin(v * 3.14159);
  float m2 = 0.5 + 0.5 * cos(v * 3.14159 + 1.5708);
  vec3 col = u_bg + u_c1 * m1 * 0.34 + u_c2 * m2 * 0.28;
  gl_FragColor = vec4(col, 1.0);
}`,
  // Liquide : distorsion de domaine (Inigo Quilez) — fumée qui monte doucement en continu
  liquide: `
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res.xy) / u_res.y * 1.6;
  p.y -= u_time * 0.05;
  float t = u_time * 0.03;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 1.5),
                fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 1.2));
  float f = fbm(p + 4.0 * r);
  vec3 col = u_bg;
  col = mix(col, u_c1 * 0.62, clamp(f * f * 1.6, 0.0, 1.0));
  col = mix(col, u_c2 * 0.55, clamp(length(q) * 0.7, 0.0, 1.0) * f);
  col += u_c2 * 0.14 * smoothstep(0.72, 1.0, f);
  gl_FragColor = vec4(col, 1.0);
}`
}

/** #rrggbb → [r,g,b] normalisé 0..1 pour les uniforms GLSL. */
function hexToVec3(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const int = parseInt(n, 16)
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255]
}

function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Convertit #rrggbb → "r,g,b" pour composer des rgba() dynamiques. */
function rgbTriplet(hex: string): string {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const int = parseInt(n, 16)
  return `${(int >> 16) & 255},${(int >> 8) & 255},${int & 255}`
}

interface Colors {
  t1: string // "r,g,b" — accent
  t2: string // "r,g,b" — accent2
  bgVec: [number, number, number]
  c1Vec: [number, number, number]
  c2Vec: [number, number, number]
}

function readColors(): Colors {
  const bg = cssColor('--color-vault-bg', '#0a0a12')
  const c1 = cssColor('--color-vault-accent', '#8b5cf6')
  const c2 = cssColor('--color-vault-accent2', '#22d3ee')
  return { t1: rgbTriplet(c1), t2: rgbTriplet(c2), bgVec: hexToVec3(bg), c1Vec: hexToVec3(c1), c2Vec: hexToVec3(c2) }
}

/** Index de teinte figé sur chaque particule à sa création — la couleur réelle n'est résolue
 *  qu'au tracé, via `colorsRef`, pour qu'un changement de thème recolore tout instantanément
 *  sans jamais relancer la simulation. */
type Tint = 0 | 1 | 2 // 0 = accent, 1 = accent2, 2 = blanc
function tintColor(tint: Tint, c: Colors): string {
  return tint === 2 ? '255,255,255' : tint === 0 ? c.t1 : c.t2
}

type Draw = (ctx: CanvasRenderingContext2D, t: number, dt: number) => void

export default function AmbientBackground({
  mode,
  theme,
  speed
}: {
  mode: BgMode
  theme: string
  speed: number
}): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // refs plutôt que dépendances d'effet : on ne veut jamais recompiler/relancer toute
  // l'animation (particules, shader) juste parce que la vitesse ou la couleur a changé —
  // seul un changement de mode doit tout reconstruire.
  const speedRef = useRef(speed)
  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  const colorsRef = useRef<Colors>(readColors())
  useEffect(() => {
    colorsRef.current = readColors()
  }, [theme])

  useEffect(() => {
    if (!CANVAS_MODES.includes(mode) && !SHADER_MODES.includes(mode)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const canvas = canvasRef.current
    if (!canvas) return

    /* ---------- branche GPU : compile et anime un fragment shader GLSL ---------- */
    if (SHADER_MODES.includes(mode)) {
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false })
      if (!gl) return // GPU indisponible → fond uni du thème (pas de crash)

      const compile = (type: number, src: string): WebGLShader | null => {
        const sh = gl.createShader(type)
        if (!sh) return null
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.warn('[AmbientBackground] shader:', gl.getShaderInfoLog(sh))
          gl.deleteShader(sh)
          return null
        }
        return sh
      }
      const vs = compile(gl.VERTEX_SHADER, VERT_SRC)
      const fs = compile(gl.FRAGMENT_SHADER, GLSL_LIB + (FRAG_SRC[mode] ?? ''))
      if (!vs || !fs) return
      const prog = gl.createProgram()
      if (!prog) return
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[AmbientBackground] link:', gl.getProgramInfoLog(prog))
        return
      }
      gl.useProgram(prog)

      // un seul triangle qui couvre tout l'écran — le fragment shader fait le reste
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const aPos = gl.getAttribLocation(prog, 'a_pos')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      const uTime = gl.getUniformLocation(prog, 'u_time')
      const uRes = gl.getUniformLocation(prog, 'u_res')
      const uBg = gl.getUniformLocation(prog, 'u_bg')
      const uC1 = gl.getUniformLocation(prog, 'u_c1')
      const uC2 = gl.getUniformLocation(prog, 'u_c2')

      const resizeGl = (): void => {
        canvas.width = Math.max(1, Math.round(window.innerWidth * SHADER_SCALE))
        canvas.height = Math.max(1, Math.round(window.innerHeight * SHADER_SCALE))
        gl.viewport(0, 0, canvas.width, canvas.height)
      }
      resizeGl()
      window.addEventListener('resize', resizeGl)

      let raf = 0
      let running = true
      let last = performance.now()
      let virtualTime = 0 // secondes, avance selon le multiplicateur de vitesse
      const frame = (now: number): void => {
        if (!running) return
        const dtReal = Math.min((now - last) / 1000, 0.05)
        last = now
        virtualTime += dtReal * speedRef.current
        const c = colorsRef.current
        gl.uniform1f(uTime, virtualTime)
        gl.uniform2f(uRes, canvas.width, canvas.height)
        gl.uniform3fv(uBg, c.bgVec)
        gl.uniform3fv(uC1, c.c1Vec)
        gl.uniform3fv(uC2, c.c2Vec)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        raf = requestAnimationFrame(frame)
      }
      const onVisibility = (): void => {
        running = document.visibilityState === 'visible'
        if (running) {
          last = performance.now()
          raf = requestAnimationFrame(frame)
        }
      }
      document.addEventListener('visibilitychange', onVisibility)
      raf = requestAnimationFrame(frame)

      return () => {
        cancelAnimationFrame(raf)
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('resize', resizeGl)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    }

    /* ---------- branche Canvas 2D (styles existants) ---------- */
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    const resize = (): void => {
      w = canvas.width = window.innerWidth
      h = canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const rand = (a: number, b: number): number => a + Math.random() * (b - a)

    /* ---------- construction du style choisi ---------- */
    let draw: Draw

    if (mode === 'halos-particules') {
      const n = 70
      const ps = Array.from({ length: n }, () => {
        const depth = Math.random()
        return {
          x: rand(0, w),
          y: rand(0, h),
          r: rand(0.6, 2.6) * (0.5 + depth),
          vy: -rand(4, 14) * (0.35 + depth * 0.65),
          sway: rand(6, 26),
          phase: rand(0, Math.PI * 2),
          tint: (Math.random() < 0.2 ? 2 : Math.random() < 0.5 ? 0 : 1) as Tint,
          alpha: rand(0.12, 0.5) * (0.4 + depth * 0.6),
          depth
        }
      })
      draw = (ctx, _t, dt) => {
        ctx.clearRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        const c = colorsRef.current
        for (const p of ps) {
          p.y += p.vy * dt
          p.phase += dt * 0.6
          if (p.y < -8) {
            p.y = h + 8
            p.x = Math.random() * w
          }
          const px = p.x + Math.sin(p.phase) * p.sway
          const py = p.y
          const col = tintColor(p.tint, c)
          const g = ctx.createRadialGradient(px, py, 0, px, py, p.r * 4)
          g.addColorStop(0, `rgba(${col},1)`)
          g.addColorStop(1, `rgba(${col},0)`)
          ctx.globalAlpha = p.alpha
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(px, py, p.r * 4, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        ctx.globalCompositeOperation = 'source-over'
      }
    } else if (mode === 'constellation') {
      const n = 90
      const link = 132
      const nodes = Array.from({ length: n }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-12, 12),
        vy: rand(-12, 12),
        depth: Math.random()
      }))
      draw = (ctx, _t, dt) => {
        ctx.clearRect(0, 0, w, h)
        const c = colorsRef.current
        for (const p of nodes) {
          p.x += p.vx * dt
          p.y += p.vy * dt
          if (p.x < 0 || p.x > w) p.vx *= -1
          if (p.y < 0 || p.y > h) p.vy *= -1
        }
        // liens entre nœuds proches
        ctx.lineWidth = 1
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i]
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]
            const d = Math.hypot(a.x - b.x, a.y - b.y)
            if (d > link) continue
            const o = (1 - d / link) * 0.5
            ctx.strokeStyle = `rgba(${c.t2},${o})`
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
        // nœuds
        ctx.globalCompositeOperation = 'lighter'
        for (const p of nodes) {
          ctx.fillStyle = `rgba(${c.t1},0.9)`
          ctx.beginPath()
          ctx.arc(p.x, p.y, 1.6 + p.depth * 1.4, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    } else if (mode === 'aurore') {
      const bands = 5
      draw = (ctx, t) => {
        ctx.clearRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        const c = colorsRef.current
        for (let b = 0; b < bands; b++) {
          const yBase = (h / (bands + 1)) * (b + 1)
          const amp = 40 + b * 26
          const speed = 0.00016 + b * 0.00006
          const phase = t * speed + b * 1.3
          const col = b % 2 === 0 ? c.t1 : c.t2
          ctx.beginPath()
          ctx.moveTo(0, h)
          for (let x = 0; x <= w; x += 24) {
            const y =
              yBase +
              Math.sin(x * 0.004 + phase) * amp +
              Math.sin(x * 0.011 + phase * 1.7) * (amp * 0.35)
            ctx.lineTo(x, y)
          }
          ctx.lineTo(w, h)
          ctx.closePath()
          const g = ctx.createLinearGradient(0, yBase - amp, 0, yBase + amp * 2)
          g.addColorStop(0, `rgba(${col},0)`)
          g.addColorStop(0.5, `rgba(${col},0.14)`)
          g.addColorStop(1, `rgba(${col},0)`)
          ctx.fillStyle = g
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    } else if (mode === 'grille') {
      // grille en perspective qui défile vers l'horizon (rétro / synthwave)
      const spacing = 46
      draw = (ctx, t) => {
        ctx.clearRect(0, 0, w, h)
        const c = colorsRef.current
        const horizon = h * 0.42
        // lueur d'horizon
        const glow = ctx.createLinearGradient(0, horizon - 120, 0, horizon + 40)
        glow.addColorStop(0, `rgba(${c.t2},0)`)
        glow.addColorStop(1, `rgba(${c.t2},0.16)`)
        ctx.fillStyle = glow
        ctx.fillRect(0, horizon - 120, w, 160)
        ctx.lineWidth = 1
        // lignes horizontales (défilement en profondeur)
        const scroll = (t * 0.00008) % 1
        for (let i = 0; i < 26; i++) {
          const p = (i + scroll) / 26
          const y = horizon + p * p * (h - horizon)
          const o = Math.min(0.5, p * 0.6)
          ctx.strokeStyle = `rgba(${c.t1},${o})`
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        // lignes verticales en fuite
        const cx = w / 2
        for (let x = -20; x <= 20; x++) {
          const fx = cx + x * spacing
          ctx.strokeStyle = `rgba(${c.t2},0.16)`
          ctx.beginPath()
          ctx.moveTo(cx + x * (spacing * 0.12), horizon)
          ctx.lineTo(fx, h)
          ctx.stroke()
        }
      }
    } else if (mode === 'meteores') {
      // ciel étoilé scintillant + étoiles filantes périodiques
      const stars = Array.from({ length: 150 }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        r: rand(0.4, 1.5),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.6, 2.2),
        tint: (Math.random() < 0.25 ? 1 : 2) as Tint,
        depth: Math.random()
      }))
      interface Meteor {
        x: number
        y: number
        vx: number
        vy: number
        life: number
        maxLife: number
        tint: Tint
      }
      const meteors: Meteor[] = []
      let nextMeteor = 1
      draw = (ctx, _t, dt) => {
        ctx.clearRect(0, 0, w, h)
        const c = colorsRef.current
        // étoiles
        for (const s of stars) {
          s.phase += dt * s.speed
          const a = 0.2 + 0.55 * (0.5 + 0.5 * Math.sin(s.phase))
          ctx.fillStyle = `rgba(${tintColor(s.tint, c)},${a})`
          ctx.beginPath()
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          ctx.fill()
        }
        // apparition d'une étoile filante
        nextMeteor -= dt
        if (nextMeteor <= 0) {
          const fromLeft = Math.random() < 0.5
          meteors.push({
            x: fromLeft ? rand(-40, w * 0.3) : rand(w * 0.7, w + 40),
            y: rand(-30, h * 0.4),
            vx: (fromLeft ? 1 : -1) * rand(380, 640),
            vy: rand(150, 300),
            life: 0,
            maxLife: rand(0.7, 1.2),
            tint: (Math.random() < 0.5 ? 0 : 1) as Tint
          })
          nextMeteor = rand(1.2, 2.6)
        }
        // traînées
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i]
          m.life += dt
          if (m.life >= m.maxLife) {
            meteors.splice(i, 1)
            continue
          }
          m.x += m.vx * dt
          m.y += m.vy * dt
          const p = m.life / m.maxLife
          const fade = Math.sin(p * Math.PI) // apparition + extinction douces
          const tailX = m.x - m.vx * 0.16
          const tailY = m.y - m.vy * 0.16
          const mcol = tintColor(m.tint, c)
          const g = ctx.createLinearGradient(tailX, tailY, m.x, m.y)
          g.addColorStop(0, `rgba(${mcol},0)`)
          g.addColorStop(1, `rgba(255,255,255,${0.85 * fade})`)
          ctx.strokeStyle = g
          ctx.lineWidth = 2.2
          ctx.beginPath()
          ctx.moveTo(tailX, tailY)
          ctx.lineTo(m.x, m.y)
          ctx.stroke()
          // tête lumineuse
          const hg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 10)
          hg.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`)
          hg.addColorStop(1, `rgba(${mcol},0)`)
          ctx.fillStyle = hg
          ctx.beginPath()
          ctx.arc(m.x, m.y, 10, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    } else if (mode === 'lucioles') {
      // lucioles : petites lueurs chaudes qui errent et pulsent
      const n = 28
      const flies = Array.from({ length: n }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        angle: rand(0, Math.PI * 2),
        speed: rand(16, 44),
        wobble: rand(0.4, 1.4),
        phase: rand(0, Math.PI * 2),
        pulse: rand(1.2, 2.6),
        size: rand(1.4, 3),
        tint: (Math.random() < 0.5 ? 0 : 1) as Tint,
        depth: Math.random()
      }))
      draw = (ctx, _t, dt) => {
        ctx.clearRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        const c = colorsRef.current
        for (const f of flies) {
          f.angle += Math.sin(f.phase * 1.7) * f.wobble * dt + (Math.random() - 0.5) * 0.4 * dt
          f.phase += dt * f.pulse
          f.x += Math.cos(f.angle) * f.speed * dt
          f.y += Math.sin(f.angle) * f.speed * dt
          // rebond doux aux bords
          if (f.x < -20) f.x = w + 20
          if (f.x > w + 20) f.x = -20
          if (f.y < -20) f.y = h + 20
          if (f.y > h + 20) f.y = -20
          const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(f.phase))
          const fcol = tintColor(f.tint, c)
          const glowR = f.size * 7
          const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, glowR)
          g.addColorStop(0, `rgba(${fcol},${0.55 * pulse})`)
          g.addColorStop(0.4, `rgba(${fcol},${0.18 * pulse})`)
          g.addColorStop(1, `rgba(${fcol},0)`)
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(f.x, f.y, glowR, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = `rgba(255,255,255,${0.75 * pulse})`
          ctx.beginPath()
          ctx.arc(f.x, f.y, f.size * 0.8, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    } else if (mode === 'vortex') {
      // spirale galactique : particules en orbite lente autour du centre
      const n = 170
      const maxR = Math.hypot(w, h) / 2
      const parts = Array.from({ length: n }, () => {
        const radius = rand(40, maxR)
        return {
          angle: rand(0, Math.PI * 2),
          radius,
          aVel: rand(0.06, 0.22) * (0.4 + 120 / (radius + 60)),
          inward: rand(2, 9),
          size: rand(0.7, 2.2),
          tint: (Math.random() < 0.15 ? 2 : Math.random() < 0.5 ? 0 : 1) as Tint,
          alpha: rand(0.25, 0.75)
        }
      })
      draw = (ctx, _t, dt) => {
        ctx.clearRect(0, 0, w, h)
        const c = colorsRef.current
        const cx = w / 2
        const cy = h / 2
        ctx.globalCompositeOperation = 'lighter'
        // cœur lumineux
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 130)
        core.addColorStop(0, `rgba(${c.t1},0.16)`)
        core.addColorStop(1, `rgba(${c.t1},0)`)
        ctx.fillStyle = core
        ctx.beginPath()
        ctx.arc(cx, cy, 130, 0, Math.PI * 2)
        ctx.fill()
        for (const p of parts) {
          p.angle += p.aVel * dt
          p.radius -= p.inward * dt
          if (p.radius < 26) {
            p.radius = maxR * rand(0.75, 1)
            p.angle = rand(0, Math.PI * 2)
          }
          const px = cx + Math.cos(p.angle) * p.radius
          const py = cy + Math.sin(p.angle) * p.radius * 0.72 // légère ellipse, plus galactique
          // traînée courte dans le sens de l'orbite
          const bx = cx + Math.cos(p.angle - p.aVel * 0.35) * (p.radius + p.inward * 0.3)
          const by = cy + Math.sin(p.angle - p.aVel * 0.35) * (p.radius + p.inward * 0.3) * 0.72
          const pcol = tintColor(p.tint, c)
          const g = ctx.createLinearGradient(bx, by, px, py)
          g.addColorStop(0, `rgba(${pcol},0)`)
          g.addColorStop(1, `rgba(${pcol},${p.alpha})`)
          ctx.strokeStyle = g
          ctx.lineWidth = p.size
          ctx.beginPath()
          ctx.moveTo(bx, by)
          ctx.lineTo(px, py)
          ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    } else if (mode === 'flux') {
      // rubans d'énergie : trajectoires fluides le long d'un champ de vecteurs, traînées persistantes
      const n = 95
      const pts = Array.from({ length: n }, () => ({
        x: rand(0, w),
        y: rand(0, h),
        speed: rand(28, 72),
        tint: (Math.random() < 0.5 ? 0 : 1) as Tint,
        alpha: rand(0.1, 0.3)
      }))
      draw = (ctx, t, dt) => {
        // estompe progressive au lieu d'un clear → les traînées persistent et s'évanouissent
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = 'rgba(0,0,0,0.055)'
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        ctx.lineCap = 'round'
        const c = colorsRef.current
        for (const p of pts) {
          const a =
            Math.sin(p.x * 0.0021 + t * 0.00014) +
            Math.cos(p.y * 0.0024 - t * 0.0001) +
            Math.sin((p.x + p.y) * 0.0009)
          const angle = a * Math.PI * 0.75
          const px = p.x
          const py = p.y
          p.x += Math.cos(angle) * p.speed * dt
          p.y += Math.sin(angle) * p.speed * dt
          let wrapped = false
          if (p.x < -4) { p.x = w + 4; wrapped = true }
          if (p.x > w + 4) { p.x = -4; wrapped = true }
          if (p.y < -4) { p.y = h + 4; wrapped = true }
          if (p.y > h + 4) { p.y = -4; wrapped = true }
          if (wrapped) continue // pas de segment à travers l'écran
          ctx.strokeStyle = `rgba(${tintColor(p.tint, c)},${p.alpha})`
          ctx.lineWidth = 1.3
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(p.x, p.y)
          ctx.stroke()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    } else {
      // orbes : grosses bulles douces (bokeh) qui montent lentement
      const n = 16
      const orbs = Array.from({ length: n }, () => {
        const depth = Math.random()
        return {
          x: rand(0, w),
          y: rand(0, h),
          r: rand(60, 190) * (0.5 + depth),
          vy: -rand(6, 20) * (0.3 + depth),
          drift: rand(-6, 6),
          phase: rand(0, Math.PI * 2),
          tint: (Math.random() < 0.5 ? 0 : 1) as Tint,
          alpha: rand(0.05, 0.14),
          depth
        }
      })
      draw = (ctx, _t, dt) => {
        ctx.clearRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'lighter'
        const c = colorsRef.current
        for (const o of orbs) {
          o.y += o.vy * dt
          o.phase += dt * 0.4
          if (o.y + o.r < -20) {
            o.y = h + o.r
            o.x = Math.random() * w
          }
          const px = o.x + Math.sin(o.phase) * o.drift * 4
          const py = o.y
          const ocol = tintColor(o.tint, c)
          const g = ctx.createRadialGradient(px, py, 0, px, py, o.r)
          g.addColorStop(0, `rgba(${ocol},${o.alpha})`)
          g.addColorStop(0.7, `rgba(${ocol},${o.alpha * 0.35})`)
          g.addColorStop(1, `rgba(${ocol},0)`)
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(px, py, o.r, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    }

    /* ---------- boucle d'animation ---------- */
    let raf = 0
    let last = performance.now()
    let running = true
    let virtualTime = last // ms, avance selon le multiplicateur de vitesse (remplace "now" réel)
    const frame = (now: number): void => {
      if (!running) return
      const dtReal = Math.min((now - last) / 1000, 0.05)
      last = now
      const dt = dtReal * speedRef.current
      virtualTime += dt * 1000
      draw(ctx, virtualTime, dt)
      raf = requestAnimationFrame(frame)
    }
    const onVisibility = (): void => {
      running = document.visibilityState === 'visible'
      if (running) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }

    // Accessibilité : si le système demande moins d'animations, on dessine UNE image
    // statique et on ne lance aucune boucle (zéro coût CPU/GPU en continu).
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      draw(ctx, virtualTime, 0)
    } else {
      document.addEventListener('visibilitychange', onVisibility)
      raf = requestAnimationFrame(frame)
    }

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', resize)
    }
    // theme et speed sont lus en direct via des refs (colorsRef/speedRef) — les changer ne doit
    // jamais relancer la simulation, seul un changement de mode le justifie
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  if (!CANVAS_MODES.includes(mode) && !SHADER_MODES.includes(mode)) return null
  return (
    <canvas
      // un canvas ne peut pas changer de type de contexte (2d ↔ webgl) → on le recrée à chaque
      // changement de mode
      key={mode}
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  )
}
