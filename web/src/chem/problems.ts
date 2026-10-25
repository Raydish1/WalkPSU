/** Easy chemistry quiz: name elements from symbols, and name common formulas (H₂O → water). */

export type ChemProblem = {
  id: string
  /** Accessible prompt text. */
  prompt: string
  /** Short instruction above the answer box. */
  hint: string
  /** What to show large on the card. */
  display: ChemDisplay
  /** Accepted answers (normalized before compare). */
  answers: string[]
}

export type ChemDisplay =
  | { kind: 'symbol'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'formula'; parts: FormulaPart[] }

export type FormulaPart = { kind: 'el'; value: string } | { kind: 'sub'; value: string }

type Element = { symbol: string; name: string; aliases?: string[] }

/** Common high-school elements. */
const ELEMENTS: readonly Element[] = [
  { symbol: 'H', name: 'Hydrogen' },
  { symbol: 'He', name: 'Helium' },
  { symbol: 'Li', name: 'Lithium' },
  { symbol: 'C', name: 'Carbon' },
  { symbol: 'N', name: 'Nitrogen' },
  { symbol: 'O', name: 'Oxygen' },
  { symbol: 'F', name: 'Fluorine' },
  { symbol: 'Ne', name: 'Neon' },
  { symbol: 'Na', name: 'Sodium' },
  { symbol: 'Mg', name: 'Magnesium' },
  { symbol: 'Al', name: 'Aluminum', aliases: ['aluminium'] },
  { symbol: 'Si', name: 'Silicon' },
  { symbol: 'P', name: 'Phosphorus' },
  { symbol: 'S', name: 'Sulfur', aliases: ['sulphur'] },
  { symbol: 'Cl', name: 'Chlorine' },
  { symbol: 'K', name: 'Potassium' },
  { symbol: 'Ca', name: 'Calcium' },
  { symbol: 'Fe', name: 'Iron' },
  { symbol: 'Cu', name: 'Copper' },
  { symbol: 'Zn', name: 'Zinc' },
  { symbol: 'Ag', name: 'Silver' },
  { symbol: 'Au', name: 'Gold' },
  { symbol: 'I', name: 'Iodine' },
  { symbol: 'Br', name: 'Bromine' },
]

type Formula = { id: string; parts: FormulaPart[]; plain: string; names: string[] }

/** Easy everyday formulas — common names welcome. */
const FORMULAS: readonly Formula[] = [
  { id: 'h2o', parts: [{ kind: 'el', value: 'H' }, { kind: 'sub', value: '2' }, { kind: 'el', value: 'O' }], plain: 'H2O', names: ['water', 'dihydrogen monoxide'] },
  { id: 'co2', parts: [{ kind: 'el', value: 'C' }, { kind: 'el', value: 'O' }, { kind: 'sub', value: '2' }], plain: 'CO2', names: ['carbon dioxide'] },
  { id: 'o2', parts: [{ kind: 'el', value: 'O' }, { kind: 'sub', value: '2' }], plain: 'O2', names: ['oxygen', 'dioxygen'] },
  { id: 'n2', parts: [{ kind: 'el', value: 'N' }, { kind: 'sub', value: '2' }], plain: 'N2', names: ['nitrogen', 'dinitrogen'] },
  { id: 'nacl', parts: [{ kind: 'el', value: 'Na' }, { kind: 'el', value: 'Cl' }], plain: 'NaCl', names: ['sodium chloride', 'salt', 'table salt'] },
  { id: 'hcl', parts: [{ kind: 'el', value: 'H' }, { kind: 'el', value: 'Cl' }], plain: 'HCl', names: ['hydrochloric acid', 'hydrogen chloride'] },
  { id: 'nh3', parts: [{ kind: 'el', value: 'N' }, { kind: 'el', value: 'H' }, { kind: 'sub', value: '3' }], plain: 'NH3', names: ['ammonia'] },
  { id: 'ch4', parts: [{ kind: 'el', value: 'C' }, { kind: 'el', value: 'H' }, { kind: 'sub', value: '4' }], plain: 'CH4', names: ['methane'] },
  { id: 'co', parts: [{ kind: 'el', value: 'C' }, { kind: 'el', value: 'O' }], plain: 'CO', names: ['carbon monoxide'] },
  { id: 'h2o2', parts: [{ kind: 'el', value: 'H' }, { kind: 'sub', value: '2' }, { kind: 'el', value: 'O' }, { kind: 'sub', value: '2' }], plain: 'H2O2', names: ['hydrogen peroxide'] },
  { id: 'caco3', parts: [{ kind: 'el', value: 'Ca' }, { kind: 'el', value: 'C' }, { kind: 'el', value: 'O' }, { kind: 'sub', value: '3' }], plain: 'CaCO3', names: ['calcium carbonate'] },
  { id: 'so2', parts: [{ kind: 'el', value: 'S' }, { kind: 'el', value: 'O' }, { kind: 'sub', value: '2' }], plain: 'SO2', names: ['sulfur dioxide', 'sulphur dioxide'] },
]

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

/** Collapse whitespace / case for forgiving text answers. */
export function normalizeChemAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export function answersMatch(guess: string, answers: string[]): boolean {
  const g = normalizeChemAnswer(guess)
  return answers.some((a) => normalizeChemAnswer(a) === g)
}

function elementFromSymbol(rand: () => number): ChemProblem {
  const el = pick(ELEMENTS, rand)
  return {
    id: `el-from-sym-${el.symbol}`,
    prompt: `Name the element with symbol ${el.symbol}`,
    hint: 'Type the element name',
    display: { kind: 'symbol', value: el.symbol },
    answers: [el.name, ...(el.aliases ?? [])],
  }
}

function symbolFromName(rand: () => number): ChemProblem {
  const el = pick(ELEMENTS, rand)
  return {
    id: `sym-from-name-${el.symbol}`,
    prompt: `What is the chemical symbol for ${el.name}?`,
    hint: 'Type the symbol (e.g. Na)',
    display: { kind: 'name', value: el.name },
    answers: [el.symbol],
  }
}

function formulaName(rand: () => number): ChemProblem {
  const f = pick(FORMULAS, rand)
  return {
    id: `formula-${f.id}`,
    prompt: `What is the common name for ${f.plain}?`,
    hint: 'Type the compound name',
    display: { kind: 'formula', parts: f.parts },
    answers: f.names,
  }
}

const GENERATORS = [elementFromSymbol, symbolFromName, formulaName] as const

/** Deterministic set: aims for a mix of element + formula questions. */
export function generateChemRound(seedKey: string, count = 3): ChemProblem[] {
  const rand = mulberry32(hashSeed(seedKey))
  const out: ChemProblem[] = []
  const used = new Set<string>()
  // Force variety on the first three slots when possible.
  const order =
    count >= 3
      ? [elementFromSymbol, formulaName, symbolFromName, ...GENERATORS]
      : [...GENERATORS]

  let guard = 0
  let i = 0
  while (out.length < count && guard++ < 80) {
    const gen = order[i++] ?? pick(GENERATORS, rand)
    const problem = gen(rand)
    if (used.has(problem.id)) continue
    used.add(problem.id)
    out.push(problem)
  }
  return out
}

export const CHEM_NEEDED = 3
