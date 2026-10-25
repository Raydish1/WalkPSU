import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { PresenceContext, type LivePlayer, type PresenceListener } from './presence'
import { useReadySession } from './session'

const SHARE_INTERVAL_MS = 5000
const SHARING_KEY = 'walkpsu:show-on-map'

// A per-device preference, not game state, so localStorage is fine; it defaults on for the demo.
function readSharing() {
  try {
    return localStorage.getItem(SHARING_KEY) !== 'off'
  } catch {
    return true
  }
}

function writeSharing(sharing: boolean) {
  try {
    localStorage.setItem(SHARING_KEY, sharing ? 'on' : 'off')
  } catch {
    // Private mode or blocked storage: the toggle still works for this session.
  }
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { player } = useReadySession()
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [others, setOthers] = useState<LivePlayer[]>([])
  const [sharing, setSharingState] = useState(readSharing)
  const positionRef = useRef(position)
  const listeners = useRef(new Set<PresenceListener>())
  const subscribe = useCallback((listener: PresenceListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    if (!navigator.geolocation) return
    const onFix = (fix: GeolocationPosition) => {
      setPosition(fix)
      for (const listener of listeners.current) listener.position?.(fix)
    }
    const id = navigator.geolocation.watchPosition(onFix, console.warn, { enableHighAccuracy: true })
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  useEffect(() => {
    const channel = supabase.channel('campus', { config: { presence: { key: player.id } } })

    let lastSent = ''
    const share = () => {
      const coords = positionRef.current?.coords
      if (!sharing || document.visibilityState !== 'visible' || !coords) return
      const payload: LivePlayer = { playerId: player.id, name: player.display_name, color: player.color, lat: coords.latitude, lng: coords.longitude }
      const serialized = JSON.stringify(payload)
      if (serialized === lastSent) return
      lastSent = serialized
      channel.track(payload)
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<LivePlayer>()
        const next = Object.entries(state)
          .filter(([key, metas]) => key !== player.id && metas.length > 0)
          .map(([, metas]) => metas[metas.length - 1])
        setOthers(next)
        for (const listener of listeners.current) listener.others?.(next)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') share()
      })

    const onVisibility = () => {
      if (document.visibilityState === 'visible') share()
      else {
        lastSent = ''
        channel.untrack()
      }
    }

    const interval = setInterval(share, SHARE_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      supabase.removeChannel(channel)
    }
  }, [player.id, player.display_name, player.color, sharing])

  const setSharing = (next: boolean) => {
    writeSharing(next)
    setSharingState(next)
  }

  return <PresenceContext.Provider value={{ position, others, sharing, setSharing, subscribe }}>{children}</PresenceContext.Provider>
}
