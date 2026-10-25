// Old Main, Penn State University Park
export const CAMPUS_CENTER: [number, number] = [40.7982, -77.8599]

/** Default highlight for buildings hosting an active drop. */
export const DROP_ACCENT = '#5ba8e0'

export const DROP_TYPES = {
  minigame: { label: 'Mini-game', color: '#5ba8e0' },
  photo_hunt: { label: 'Photo hunt', color: '#7eb6e8' },
  checkin: { label: 'Check-in', color: '#a8d4f0' },
} as const

/** Extra search terms for buildings whose official PASDA names don't match what students call them. */
export const BUILDING_NICKNAMES: Record<string, string> = {
  '0005000': 'HUB-Robeson Center',
  '0045000': 'Bryce Jordan Center BJC',
  '0039000': 'IST Building',
}
