// Old Main, Penn State University Park
export const CAMPUS_CENTER: [number, number] = [40.7982, -77.8599]

export const OSM_TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

export const DROP_TYPES = {
  minigame: { label: 'Mini-game', color: '#7c3aed' },
  photo_hunt: { label: 'Photo hunt', color: '#db2777' },
  checkin: { label: 'Check-in', color: '#0891b2' },
} as const
