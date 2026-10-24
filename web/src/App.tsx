import { Route, Routes } from 'react-router'
import BottomNav from './components/BottomNav'
import AdminPage from './pages/AdminPage'
import LeaderboardPage from './pages/LeaderboardPage'
import MapPage from './pages/MapPage'
import ProfilePage from './pages/ProfilePage'

function App() {
  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}

export default App
