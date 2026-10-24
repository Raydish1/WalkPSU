import type { PostgrestSingleResponse } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Database, DropRow, NewDrop, PlayerRow } from './database.types'

function unwrap<T>(response: PostgrestSingleResponse<T>): T {
  if (response.error) throw new Error(response.error.message)
  return response.data
}

export async function getPlayer(authId: string) {
  return unwrap(await supabase.from('players').select('*').eq('auth_id', authId).maybeSingle())
}

export async function createPlayer(displayName: string) {
  return unwrap(await supabase.from('players').insert({ display_name: displayName }).select().single())
}

export async function updatePlayer(id: string, changes: Partial<Pick<PlayerRow, 'display_name'>>) {
  return unwrap(await supabase.from('players').update(changes).eq('id', id).select().single())
}

export async function getPlayers() {
  return unwrap(await supabase.from('players').select('*'))
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

export type ClaimProof = { lat: number; lng: number } | { code: string }

/** Server checks the drop is active and unexpired, and that the player is within claim_radius_m() or has its QR code. */
export async function claimDrop(dropId: string, proof: ClaimProof) {
  const args = 'code' in proof ? { p_code: proof.code } : { p_lat: proof.lat, p_lng: proof.lng }
  return unwrap(await supabase.rpc('claim_drop', { p_drop_id: dropId, ...args }))
}

/** Admin only (enforced by RLS). Maps drop id to its QR claim code. */
export async function getClaimCodes() {
  const rows = unwrap(await supabase.from('drop_secrets').select('*'))
  return new Map(rows.map((row) => [row.drop_id, row.claim_code]))
}

export function claimUrl(dropId: string, code: string) {
  return `${window.location.origin}/claim/${dropId}?key=${code}`
}

export async function getBuildingControl() {
  return unwrap(await supabase.from('building_control').select('*'))
}

export async function getLeaderboard() {
  return unwrap(
    await supabase
      .from('player_scores')
      .select('*')
      .order('points', { ascending: false })
      .order('buildings', { ascending: false })
      .order('display_name'),
  )
}

/** The server's GPS claim radius in meters, so the map draws exactly what claim_drop enforces. */
export async function getClaimRadius() {
  return unwrap(await supabase.rpc('claim_radius_m'))
}

type RealtimeTable = 'drops' | 'claims' | 'building_control'
type RowOf<T extends RealtimeTable> = Database['public']['Tables'][T]['Row']

/** Calls onChange for every insert/update/delete on a Realtime-enabled table. Returns an unsubscribe fn. */
export function subscribeToTable<T extends RealtimeTable>(
  table: T,
  onChange: (row: RowOf<T>, event: 'INSERT' | 'UPDATE' | 'DELETE') => void,
) {
  const channel = supabase
    .channel(`${table}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      onChange((payload.eventType === 'DELETE' ? payload.old : payload.new) as RowOf<T>, payload.eventType)
    })
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

/** Claims flip a drop's status, so this also fires on every claim. */
export function subscribeToDrops(onChange: (drop: DropRow, event: 'INSERT' | 'UPDATE' | 'DELETE') => void) {
  return subscribeToTable('drops', onChange)
}
