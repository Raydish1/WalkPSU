import { Route, Routes, useLocation } from 'react-router'
import BottomNav from './components/BottomNav'
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

function Screens() {
  const session = useSession()
  const { pathname } = useLocation()
  if (session.status !== 'ready') return <JoinScreen />

  return (
    <PresenceProvider>
      <div className="app">
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
        {!FULL_SCREEN.test(pathname) && <BottomNav />}
      </div>
    </PresenceProvider>
  )
}

function App() {
  return (
    <SessionProvider>
      <Screens />
    </SessionProvider>
  )
}

export default App
