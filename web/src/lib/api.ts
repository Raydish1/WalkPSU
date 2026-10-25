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
  const first = await supabase.from('drops').insert(drop).select().single()
  if (!first.error) return first.data
  // Older projects may not have run the category migration yet — retry without it.
  if (drop.category != null && /category/i.test(first.error.message)) {
    const { category: _omit, ...rest } = drop
    return unwrap(await supabase.from('drops').insert(rest).select().single())
  }
  return unwrap(first)
}

/** Admin only. Returns the public URL to store as the drop's hint_photo_url. */
export async function uploadHintPhoto(file: File) {
  const path = `${crypto.randomUUID()}-${file.name}`
  const { error } = await supabase.storage.from('drop-hints').upload(path, file)
  if (error) throw new Error(error.message)
  return supabase.storage.from('drop-hints').getPublicUrl(path).data.publicUrl
}

export async function getDrop(id: string) {
  return unwrap(await supabase.from('drops').select('*').eq('id', id).maybeSingle())
}

export type ClaimProof = { lat: number; lng: number } | { code: string }

const proofArgs = (proof: ClaimProof) => ('code' in proof ? { p_code: proof.code } : { p_lat: proof.lat, p_lng: proof.lng })

/** Server checks the drop is active and unexpired, and that the player is within claim_radius_m() or has its QR code. */
export async function claimDrop(dropId: string, proof: ClaimProof) {
  return unwrap(await supabase.rpc('claim_drop', { p_drop_id: dropId, ...proofArgs(proof) }))
}

export async function getGameState(dropId: string) {
  return unwrap(await supabase.rpc('get_game_state', { p_drop_id: dropId }))
}

/** Same proof as claiming. Rejoining is a no-op; joining closes when the game starts. */
export async function joinGame(dropId: string, proof: ClaimProof) {
  unwrap(await supabase.rpc('join_game', { p_drop_id: dropId, ...proofArgs(proof) }))
}

/** Admin only. Starts the countdown (needs 2+ players). */
export async function startGame(dropId: string) {
  unwrap(await supabase.rpc('start_game', { p_drop_id: dropId }))
}

/** Reports a running shake total; the server caps it to a human rate and returns the stored value. */
export async function submitShakes(dropId: string, count: number) {
  return unwrap(await supabase.rpc('submit_shakes', { p_drop_id: dropId, p_count: count }))
}

/** Idempotent; any participant may call it once the submit grace period has passed. */
export async function finishGame(dropId: string) {
  return unwrap(await supabase.rpc('finish_game', { p_drop_id: dropId }))
}

/** Admin only (enforced by RLS). Maps drop id to its QR claim code. */
export async function getClaimCodes() {
  const rows = unwrap(await supabase.from('drop_secrets').select('*'))
  return new Map(rows.map((row) => [row.drop_id, row.claim_code]))
}

export function claimUrl(dropId: string, code: string) {
  return `${window.location.origin}/claim/${dropId}?key=${code}`
}

export async function getLeaderboard() {
  return unwrap(
    await supabase
      .from('player_scores')
      .select('*')
      .order('points', { ascending: false })
      .order('display_name'),
  )
}

/** The server's GPS claim radius in meters, so the map draws exactly what claim_drop enforces. */
export async function getClaimRadius() {
  return unwrap(await supabase.rpc('claim_radius_m'))
}

type RealtimeTable = 'drops' | 'claims' | 'games' | 'game_players'
type RowOf<T extends RealtimeTable> = Database['public']['Tables'][T]['Row']

/** Calls onChange for every insert/update/delete on a Realtime-enabled table. Returns an unsubscribe fn. */
export function subscribeToTable<T extends RealtimeTable>(
  table: T,
  onChange: (row: RowOf<T>, event: 'INSERT' | 'UPDATE' | 'DELETE') => void,
  filter?: string,
) {
  const channel = supabase
    .channel(`${table}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) => {
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
