import type { MinigameKind } from '../lib/database.types'

/** What players see before they walk over: the admin picker, the drop card, and the lobby all use this. */
export const MINIGAMES: Record<MinigameKind, { name: string; blurb: string }> = {
  shake_off: {
    name: 'Shake-Off',
    blurb: 'Two random teams shake their phones for 15 seconds. Most shakes per player wins.',
  },
  quick_draw: {
    name: 'Quick Draw',
    blurb: 'Hold still, then flick your phone the instant it flashes DRAW! Three rounds. The faster team wins.',
  },
  needle_rain: {
    name: 'Needle Rain',
    blurb: 'One shared storm. Tilt to dodge the needles. Last one standing takes the points.',
  },
}

export const minigameOf = (game: MinigameKind | null | undefined) => MINIGAMES[game ?? 'shake_off']
