import { useState } from 'react'
import type { Building } from '../lib/buildings'
import { BUILDING_NICKNAMES } from '../lib/campus'
import { ChevronIcon } from './icons'

function BuildingPicker({ buildings, onPick }: { buildings: Building[]; onPick: (building: Building) => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const searchText = ({ properties: p }: Building) => `${p.name} ${BUILDING_NICKNAMES[p.num] ?? ''}`.toLowerCase()
  const matches = q ? buildings.filter((b) => searchText(b).includes(q)).slice(0, 8) : []

  return (
    <div className="stack-sm">
      <input
        className="input"
        type="search"
        placeholder="Search buildings (e.g. HUB, Old Main)"
        enterKeyHint="search"
        autoCorrect="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="list picker-list">
          {matches.map((b) => (
            <li key={b.properties.num}>
              <button
                type="button"
                className="list-row picker-option"
                onClick={() => {
                  onPick(b)
                  setQuery('')
                }}
              >
                <span className="list-row-main">{b.properties.name}</span>
                <ChevronIcon className="chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default BuildingPicker
