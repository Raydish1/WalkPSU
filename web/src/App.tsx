import { Route, Routes } from 'react-router'
import BottomNav from './components/BottomNav'
import AdminPage from './pages/AdminPage'
import ClaimPage from './pages/ClaimPage'
import JoinScreen from './pages/JoinScreen'
import LeaderboardPage from './pages/LeaderboardPage'
import MapPage from './pages/MapPage'
import ProfilePage from './pages/ProfilePage'
import { useSession } from './session/session'
import { SessionProvider } from './session/SessionProvider'

function Screens() {
  const session = useSession()
  if (session.status !== 'ready') return <JoinScreen />

  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/claim/:dropId" element={<ClaimPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
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
