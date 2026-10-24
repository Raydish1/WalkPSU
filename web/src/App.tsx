import { MapContainer, TileLayer } from 'react-leaflet'

// Old Main, Penn State University Park
const CAMPUS_CENTER: [number, number] = [40.7982, -77.8599]

function App() {
  return (
    <MapContainer center={CAMPUS_CENTER} zoom={16} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
    </MapContainer>
  )
}

export default App
