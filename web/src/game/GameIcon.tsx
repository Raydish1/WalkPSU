import { BoltIcon, CompassIcon, NeedleIcon, ShakeIcon } from '../components/icons'
import type { MinigameKind } from '../lib/database.types'

const ICONS = { shake_off: ShakeIcon, quick_draw: BoltIcon, needle_rain: NeedleIcon, landmark: CompassIcon } satisfies Record<MinigameKind, unknown>

/** Each mini-game's icon, next to its name wherever a player picks or meets the game. */
function GameIcon({ kind, size = 18 }: { kind: MinigameKind; size?: number }) {
  const Icon = ICONS[kind]
  return <Icon size={size} className="game-icon" />
}

export default GameIcon
