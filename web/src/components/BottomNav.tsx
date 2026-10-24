import { NavLink } from 'react-router'

const TABS = [
  { to: '/', label: 'Map', icon: '🗺️' },
  { to: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { to: '/profile', label: 'Profile', icon: '👤' },
]

function BottomNav() {
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end className="bottom-nav-tab">
          <span aria-hidden>{tab.icon}</span>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

export default BottomNav
