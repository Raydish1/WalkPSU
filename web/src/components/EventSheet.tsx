import { Drawer } from 'vaul'
import type { EventResult } from '../lib/api'
import { eventTime } from '../lib/eventTime'
import { ClockIcon, PinIcon } from './icons'
import { useNonModalSheet } from './useNonModalSheet'

type Props = { event: EventResult | null; open: boolean; onClose: () => void }

/** A searched event's details, after the map flies to its building. Non-modal, like DropSheet. */
function EventSheet({ event, open, onClose }: Props) {
  useNonModalSheet(open)
  return (
    <Drawer.Root open={open && event !== null} onOpenChange={(next) => !next && onClose()} modal={false}>
      <Drawer.Portal>
        <Drawer.Content className="drop-sheet map-card event-sheet" aria-describedby={undefined} onInteractOutside={(e) => e.preventDefault()}>
          <Drawer.Handle className="drop-sheet-handle" />
          {event && (
            <div className="drop-card">
              <div className="drop-card-head">
                <span className="chip">{event.theme ?? 'Campus event'}</span>
              </div>
              <div className="drop-card-title">
                <Drawer.Title asChild>
                  <h3>{event.title}</h3>
                </Drawer.Title>
                {event.organization && <p className="drop-subtitle">{event.organization}</p>}
              </div>
              <span className="event-time">
                <ClockIcon size={16} />
                {eventTime(event.starts_at, event.ends_at)}
              </span>
              <span className="range">
                <PinIcon size={16} />
                {event.building ? `${event.building.name}${event.location && event.location !== event.building.name ? ` · ${event.location}` : ''}` : `${event.location ?? 'Location TBA'} · no map pin`}
              </span>
              {event.reason && <p className="search-reason">{event.reason}</p>}
              <span className="muted footnote">From Penn State Discover. Not a drop, so there are no points here.</span>
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

export default EventSheet
