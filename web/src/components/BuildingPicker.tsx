import { useState } from 'react'
import type { Building } from '../lib/buildings'
import { BUILDING_NICKNAMES } from '../lib/campus'

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
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="picker-list">
          {matches.map((b) => (
            <li key={b.properties.num}>
              <button
                type="button"
                className="picker-option"
                onClick={() => {
                  onPick(b)
                  setQuery('')
                }}
              >
                {b.properties.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default BuildingPicker
