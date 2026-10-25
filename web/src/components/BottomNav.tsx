import type { CSSProperties } from 'react'
import { NavLink, useLocation } from 'react-router'
import { MapIcon, PersonIcon, StarIcon, TrophyIcon } from './icons'

const TABS = [
  { to: '/', label: 'Map', Icon: MapIcon },
  { to: '/challenges', label: 'Challenges', Icon: StarIcon },
  { to: '/leaderboard', label: 'Leaderboard', Icon: TrophyIcon },
  { to: '/profile', label: 'Profile', Icon: PersonIcon },
]

function BottomNav() {
  const { pathname } = useLocation()
  const index = TABS.findIndex((tab) => (tab.to === '/' ? pathname === '/' : pathname.startsWith(tab.to)))
  return (
    <nav className="bottom-nav" aria-label="Main">
      {/* A pill slides between tabs; it hides on screens outside the tabs (admin, claim). */}
      <span className="bottom-nav-indicator" style={{ '--tab': Math.max(index, 0), '--tabs': TABS.length } as CSSProperties} data-hidden={index < 0 || undefined} aria-hidden />
      {TABS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} className="bottom-nav-tab">
          <Icon size={24} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

export default BottomNav
