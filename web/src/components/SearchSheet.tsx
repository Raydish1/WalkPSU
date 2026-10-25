import { useState, type FormEvent } from 'react'
import { Drawer } from 'vaul'
import { searchEvents, type EventResult } from '../lib/api'
import type { DropRow } from '../lib/database.types'
import { eventTime } from '../lib/eventTime'
import { ChevronIcon, SearchIcon } from './icons'

const EXAMPLES = ['free food', 'something for CS majors', 'music tonight']
const MAX_QUERY = 200

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Seeded drops (source_id "discover:<event id>"), so a result can link to the drop players can claim. */
  dropFor: (eventId: string) => DropRow | undefined
  onPick: (result: EventResult, drop: DropRow | undefined) => void
}

type Status = { kind: 'idle' } | { kind: 'searching' } | { kind: 'done'; results: EventResult[] } | { kind: 'error'; message: string }

/** AI search over Penn State Discover events. Modal: a short, focused task with the keyboard up. */
function SearchSheet({ open, onOpenChange, dropFor, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function run(text: string) {
    const q = text.trim()
    if (q.length < 2 || status.kind === 'searching') return
    setQuery(q)
    setStatus({ kind: 'searching' })
    try {
      setStatus({ kind: 'done', results: await searchEvents(q) })
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    // Drops the keyboard so the results have the room.
    ;(document.activeElement as HTMLElement | null)?.blur()
    run(query)
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-overlay" />
        <Drawer.Content className="drop-sheet search-sheet" aria-describedby={undefined}>
          <Drawer.Handle className="drop-sheet-handle" />
          <Drawer.Title className="visually-hidden">Find events</Drawer.Title>
          <form className="search-field" role="search" onSubmit={submit}>
            <SearchIcon size={20} className="muted" />
            <input
              className="search-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={MAX_QUERY}
              placeholder="Find events you’d like…"
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Describe events you’d like"
            />
          </form>

          {status.kind === 'idle' && (
            <div className="stack-sm">
              <span className="muted footnote">Describe what you’re in the mood for. Try:</span>
              <div className="example-chips">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" className="chip example-chip" onClick={() => run(example)}>
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status.kind === 'searching' && (
            <div className="search-status" role="status">
              <span className="spinner" aria-hidden />
              <span className="muted">Searching campus events…</span>
            </div>
          )}

          {status.kind === 'error' && (
            <div className="search-status" role="alert">
              <span className="error">{status.message}</span>
              <button type="button" className="button" onClick={() => run(query)}>
                Try again
              </button>
            </div>
          )}

          {status.kind === 'done' &&
            (status.results.length === 0 ? (
              <div className="search-status">
                <strong>Nothing matched — try something broader</strong>
                <span className="muted footnote">Like “food”, “sports”, or “anything tonight”.</span>
              </div>
            ) : (
              <ul className="list search-results">
                {status.results.map((result) => {
                  const drop = dropFor(result.id)
                  return (
                    <li key={result.id}>
                      <button type="button" className="list-row search-result" onClick={() => onPick(result, drop)}>
                        <span className="list-row-main">
                          <strong className="search-result-title">{result.title}</strong>
                          {result.organization && <span className="muted footnote truncate">{result.organization}</span>}
                          <span className="footnote search-result-meta">
                            {eventTime(result.starts_at, result.ends_at)} · {result.building?.name ?? result.location ?? 'Location TBA'}
                          </span>
                          {result.reason && <span className="search-reason footnote">{result.reason}</span>}
                          {drop && <span className="chip claimable-chip">Claimable · {drop.points} pts</span>}
                        </span>
                        <ChevronIcon className="chevron" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            ))}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

export default SearchSheet
