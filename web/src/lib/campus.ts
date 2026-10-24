// Old Main, Penn State University Park
export const CAMPUS_CENTER: [number, number] = [40.7982, -77.8599]

export const OSM_TILES = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

/** Highlight for buildings hosting an active drop. */
export const DROP_ACCENT = '#f97316'

export const DROP_TYPES = {
  minigame: { label: 'Mini-game', color: '#7c3aed' },
  photo_hunt: { label: 'Photo hunt', color: '#db2777' },
  checkin: { label: 'Check-in', color: '#0891b2' },
} as const

/** Extra search terms for buildings whose official PASDA names don't match what students call them. */
export const BUILDING_NICKNAMES: Record<string, string> = {
  '0005000': 'HUB-Robeson Center',
  '0045000': 'Bryce Jordan Center BJC',
  '0039000': 'IST Building',
}
