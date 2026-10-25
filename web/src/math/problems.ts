/** Mental-math problems with integer answers: subtract, divide, √, and fractions. */

export type MathProblem = {
  id: string
  /** Plain prompt for accessibility / input labels. */
  prompt: string
  /** Short LaTeX-ish tokens for display (we render simply in React). */
  parts: MathPart[]
  answer: number
}

export type MathPart =
  | { kind: 'text'; value: string }
  | { kind: 'sqrt'; value: number }
  | { kind: 'frac'; num: number; den: number }

const PERFECT_SQUARES = [4, 9, 16, 25, 36, 49, 64, 81, 100, 121, 144] as const

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)]!
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function hashSeed(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** √n − k  (positive integer). */
function sqrtMinus(rand: () => number): MathProblem {
  const n = pick(PERFECT_SQUARES, rand)
  const root = Math.sqrt(n)
  const k = 1 + Math.floor(rand() * Math.min(6, root - 1))
  return {
    id: `sqrt-sub-${n}-${k}`,
    prompt: `√${n} − ${k}`,
    parts: [{ kind: 'sqrt', value: n }, { kind: 'text', value: ` − ${k}` }],
    answer: root - k,
  }
}

/** √n ÷ d  (divides evenly). */
function sqrtDivide(rand: () => number): MathProblem {
  const options = PERFECT_SQUARES.flatMap((n) => {
    const root = Math.sqrt(n)
    return [2, 3, 4, 5].filter((d) => root % d === 0).map((d) => ({ n, d, root }))
  })
  const { n, d, root } = pick(options, rand)
  return {
    id: `sqrt-div-${n}-${d}`,
    prompt: `√${n} ÷ ${d}`,
    parts: [{ kind: 'sqrt', value: n }, { kind: 'text', value: ` ÷ ${d}` }],
    answer: root / d,
  }
}

/** (a/b) of n  — “fraction of a whole number”. */
function fractionOf(rand: () => number): MathProblem {
  const dens = [2, 3, 4, 5] as const
  const den = pick(dens, rand)
  const num = 1 + Math.floor(rand() * (den - 1))
  const multiples = [2, 3, 4, 5, 6, 8, 10].map((m) => m * den)
  const whole = pick(multiples, rand)
  return {
    id: `frac-of-${num}-${den}-${whole}`,
    prompt: `${num}/${den} of ${whole}`,
    parts: [{ kind: 'frac', num, den }, { kind: 'text', value: ` of ${whole}` }],
    answer: (num * whole) / den,
  }
}

/** n − (a/b) of m */
function subtractFraction(rand: () => number): MathProblem {
  const den = pick([2, 4, 5] as const, rand)
  const num = den === 2 ? 1 : pick([1, den === 4 ? 3 : 2] as const, rand)
  const m = pick([10, 12, 16, 20, 24] as const, rand)
  const piece = (num * m) / den
  if (!Number.isInteger(piece)) return fractionOf(rand)
  const n = piece + 2 + Math.floor(rand() * 8)
  return {
    id: `sub-frac-${n}-${num}-${den}-${m}`,
    prompt: `${n} − ${num}/${den} of ${m}`,
    parts: [{ kind: 'text', value: `${n} − ` }, { kind: 'frac', num, den }, { kind: 'text', value: ` of ${m}` }],
    answer: n - piece,
  }
}

/** √n − (a/b) of m */
function sqrtMinusFraction(rand: () => number): MathProblem {
  const n = pick([36, 49, 64, 81, 100, 121, 144] as const, rand)
  const root = Math.sqrt(n)
  const den = pick([2, 4] as const, rand)
  const num = 1
  const m = pick([8, 12, 16, 20] as const, rand)
  const piece = (num * m) / den
  if (root <= piece) return sqrtMinus(rand)
  return {
    id: `sqrt-frac-${n}-${num}-${den}-${m}`,
    prompt: `√${n} − ${num}/${den} of ${m}`,
    parts: [{ kind: 'sqrt', value: n }, { kind: 'text', value: ' − ' }, { kind: 'frac', num, den }, { kind: 'text', value: ` of ${m}` }],
    answer: root - piece,
  }
}

/** n ÷ (a/b)  = n × (b/a)  when result is a small integer. */
function divideByFraction(rand: () => number): MathProblem {
  const den = pick([2, 3, 4, 5] as const, rand)
  const num = 1
  const whole = 2 + Math.floor(rand() * 8)
  return {
    id: `div-frac-${whole}-${num}-${den}`,
    prompt: `${whole} ÷ (${num}/${den})`,
    parts: [{ kind: 'text', value: `${whole} ÷ ` }, { kind: 'frac', num, den }],
    answer: whole * (den / num),
  }
}

const GENERATORS = [sqrtMinus, sqrtDivide, fractionOf, subtractFraction, sqrtMinusFraction, divideByFraction]

/** Deterministic set of mental-math problems for a drop (same drop → same set). */
export function generateMathRound(seedKey: string, count = 3): MathProblem[] {
  const rand = mulberry32(hashSeed(seedKey))
  const out: MathProblem[] = []
  const used = new Set<string>()
  let guard = 0
  while (out.length < count && guard++ < 80) {
    const problem = pick(GENERATORS, rand)(rand)
    if (used.has(problem.id) || !Number.isInteger(problem.answer) || problem.answer < 0) continue
    used.add(problem.id)
    out.push(problem)
  }
  return out
}

export const MATH_NEEDED = 3
