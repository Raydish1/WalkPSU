import type { CSSProperties } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import BottomNav from './components/BottomNav'
import DropAlerts from './components/DropAlerts'
import AdminPage from './pages/AdminPage'
import BattlePage from './pages/BattlePage'
import ClaimPage from './pages/ClaimPage'
import GamePage from './pages/GamePage'
import JoinScreen from './pages/JoinScreen'
import LeaderboardPage from './pages/LeaderboardPage'
import MapPage from './pages/MapPage'
import ProfilePage from './pages/ProfilePage'
import { PresenceProvider } from './session/PresenceProvider'
import { useSession } from './session/session'
import { SessionProvider } from './session/SessionProvider'

// Full-screen game views: no bottom nav to mis-tap while shaking or on the projector.
const FULL_SCREEN = /^\/(game|battle)\//

// Sonner reads these on the toaster; pointing them at our tokens makes toasts match the app.
const TOAST_THEME = {
  '--normal-bg': 'var(--material-strong)',
  '--normal-border': 'var(--material-edge)',
  '--normal-text': 'var(--text)',
  '--border-radius': '18px',
} as CSSProperties

function Screens() {
  const session = useSession()
  const { pathname } = useLocation()
  if (session.status !== 'ready') return <JoinScreen />
  const fullScreen = FULL_SCREEN.test(pathname)

  return (
    <PresenceProvider>
      <div className="app" data-chrome={fullScreen ? 'none' : 'tabs'}>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<MapPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/claim/:dropId" element={<ClaimPage />} />
            <Route path="/game/:dropId" element={<GamePage />} />
            <Route path="/battle/:dropId" element={<BattlePage />} />
          </Routes>
        </main>
        {!fullScreen && <BottomNav />}
        {!fullScreen && <DropAlerts />}
      </div>
    </PresenceProvider>
  )
}

function App() {
  return (
    <SessionProvider>
      <Screens />
      <Toaster
        position="top-center"
        theme="light"
        gap={8}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)', left: 12, right: 12 }}
        toastOptions={{ className: 'toast' }}
        style={TOAST_THEME}
      />
    </SessionProvider>
  )
}

export default App
