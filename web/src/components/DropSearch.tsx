import { useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { searchEvents, type SearchEvent } from '../lib/api'
import { CrossIcon, SearchIcon } from './icons'

/** Quick picks shown under the empty search bar. Kept to five so the menu stays small on a phone. */
const CATEGORIES = [
  { label: 'Sports', emoji: '🏀' },
  { label: 'Music', emoji: '🎵' },
  { label: 'Food', emoji: '🍕' },
  { label: 'Arts', emoji: '🎨' },
  { label: 'Games', emoji: '🎮' },
]

type Props = {
  events: SearchEvent[]
  /** True while a search is narrowing the map, so the clear button stays after the field loses focus. */
  filtering: boolean
  onFilter: (query: string, ids: string[]) => void
  onClear: () => void
}

/** "Find events" bar on the map: Gemini picks the events that fit what the player typed, and the map hides the rest. */
function DropSearch({ events, filtering, onFilter, onClear }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function run(query: string) {
    if (!query) return clear()
    input.current?.blur()
    setBusy(true)
    try {
      onFilter(query, await searchEvents(query, events))
    } catch (err) {
      toast.error('Couldn’t search', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    run(text.trim())
  }

  function clear() {
    setText('')
    onClear()
  }

  return (
    <form className="map-search glass" role="search" onSubmit={submit}>
      <SearchIcon size={20} className="muted" />
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => e.key === 'Escape' && input.current?.blur()}
        placeholder="Find events, e.g. basketball"
        aria-label="Find events"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={100}
        disabled={busy}
      />
      {busy ? (
        <span className="spinner map-search-spinner" role="status" aria-label="Searching" />
      ) : (
        (text || filtering) && (
          <button type="button" className="map-search-clear" aria-label="Clear search" onClick={clear}>
            <CrossIcon size={16} />
          </button>
        )
      )}
      {focused && !text && (
        <ul className="map-search-menu glass" aria-label="Categories">
          {CATEGORIES.map(({ label, emoji }) => (
            <li key={label}>
              <button
                type="button"
                // Keep the field focused through the tap, or the menu would close before the click lands.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  setText(label)
                  run(label)
                }}
              >
                <span aria-hidden>{emoji}</span>
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}

export default DropSearch
