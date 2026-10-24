import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { DropRow, NewDrop, PlayerRow } from './database.types'

function unwrap<T>(response: PostgrestSingleResponse<T>): T {
  if (response.error) throw new Error(response.error.message)
  return response.data
}

export async function getTeams() {
  return unwrap(await supabase.from('teams').select('*').order('name'))
}

export async function getPlayer(authId: string) {
  return unwrap(await supabase.from('players').select('*').eq('auth_id', authId).maybeSingle())
}

export async function createPlayer(displayName: string, teamId: string) {
  return unwrap(await supabase.from('players').insert({ display_name: displayName, team_id: teamId }).select().single())
}

export async function updatePlayer(id: string, changes: Partial<Pick<PlayerRow, 'display_name' | 'team_id'>>) {
  return unwrap(await supabase.from('players').update(changes).eq('id', id).select().single())
}

/** Active drops that haven't expired. */
export async function getDrops() {
  const now = new Date().toISOString()
  return unwrap(
    await supabase
      .from('drops')
      .select('*')
      .eq('status', 'active')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('created_at', { ascending: false }),
  )
}

/** Admin only (enforced by RLS). */
export async function createDrop(drop: NewDrop) {
  return unwrap(await supabase.from('drops').insert(drop).select().single())
}

/** Admin only. Returns the public URL to store as the drop's hint_photo_url. */
export async function uploadHintPhoto(file: File) {
  const path = `${crypto.randomUUID()}-${file.name}`
  const { error } = await supabase.storage.from('drop-hints').upload(path, file)
  if (error) throw new Error(error.message)
  return supabase.storage.from('drop-hints').getPublicUrl(path).data.publicUrl
}

/** Server checks the drop is still active, unexpired, and within 60 m of the given position. */
export async function claimDrop(dropId: string, lat: number, lng: number) {
  return unwrap(await supabase.rpc('claim_drop', { p_drop_id: dropId, p_lat: lat, p_lng: lng }))
}

export async function getLeaderboard() {
  return unwrap(await supabase.from('team_scores').select('*').order('points', { ascending: false }))
}

/** Calls onChange for every insert/update/delete on drops (claims flip a drop's status). Returns an unsubscribe fn. */
export function subscribeToDrops(onChange: (drop: DropRow, event: 'INSERT' | 'UPDATE' | 'DELETE') => void) {
  const channel = supabase
    .channel(`drops-${crypto.randomUUID()}`)
    .on<DropRow>('postgres_changes', { event: '*', schema: 'public', table: 'drops' }, (payload) => {
      const drop = (payload.eventType === 'DELETE' ? payload.old : payload.new) as DropRow
      onChange(drop, payload.eventType)
    })
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}
