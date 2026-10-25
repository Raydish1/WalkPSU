// Hand-written to match supabase/migrations. Keep in sync with every migration.
// (Or regenerate: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts)

export type DropType = 'minigame' | 'photo_hunt' | 'checkin' | 'math' | 'chemistry'
export type DropStatus = 'active' | 'claimed' | 'expired'

type Player = {
  id: string
  auth_id: string
  display_name: string
  /** Server-assigned map color. */
  color: string
  is_admin: boolean
  created_at: string
}

type Drop = {
  id: string
  title: string
  type: DropType
  /** Event theme for search/filter: sports, culture, academics, social, campus. */
  category?: string | null
  lat: number
  lng: number
  points: number
  status: DropStatus
  hint_photo_url: string | null
  building_num: string | null
  created_by: string | null
  created_at: string
  expires_at: string | null
}

type Claim = { id: string; drop_id: string; player_id: string; created_at: string }

type DropSecret = { drop_id: string; claim_code: string }

export type Side = 'blue' | 'white'

type Game = { drop_id: string; created_at: string; started_at: string | null; finished_at: string | null; winner_side: Side | null }

type GamePlayerRow = { drop_id: string; player_id: string; joined_at: string; shakes: number }

/** Mirrors SQL shake_off_settings(); the server is the only source of these numbers. */
export type ShakeOffSettings = {
  game_seconds: number
  auto_start_players: number
  auto_start_delay_seconds: number
  admin_start_delay_seconds: number
  max_shakes_per_second: number
  submit_grace_seconds: number
}

export type GamePlayer = { player_id: string; display_name: string; color: string; side: Side | null; shakes: number; joined_at: string }

/** Returned by get_game_state() and finish_game(). `game` is null until someone joins. */
export type GameState = { server_now: string; settings: ShakeOffSettings; game: Game | null; players: GamePlayer[] }

type PlayerScore = { player_id: string; display_name: string; color: string; points: number; claims: number }

export type Database = {
  public: {
    Tables: {
      players: {
        Row: Player
        Insert: Pick<Player, 'display_name'>
        Update: Partial<Pick<Player, 'display_name'>>
        Relationships: []
      }
      drops: {
        Row: Drop
        Insert: Pick<Drop, 'title' | 'type' | 'lat' | 'lng'> &
          Partial<Pick<Drop, 'category' | 'points' | 'status' | 'hint_photo_url' | 'building_num' | 'created_by' | 'expires_at'>>
        Update: Partial<Omit<Drop, 'id' | 'created_at'>>
        Relationships: []
      }
      claims: { Row: Claim; Insert: never; Update: never; Relationships: [] }
      drop_secrets: { Row: DropSecret; Insert: never; Update: never; Relationships: [] }
      games: { Row: Game & { seed: string }; Insert: never; Update: never; Relationships: [] }
      game_players: { Row: GamePlayerRow; Insert: never; Update: never; Relationships: [] }
    }
    Views: {
      player_scores: { Row: PlayerScore; Relationships: [] }
    }
    Functions: {
      claim_drop: { Args: { p_drop_id: string; p_lat?: number; p_lng?: number; p_code?: string }; Returns: Claim }
      claim_radius_m: { Args: Record<string, never>; Returns: number }
      get_game_state: { Args: { p_drop_id: string }; Returns: GameState }
      join_game: { Args: { p_drop_id: string; p_lat?: number; p_lng?: number; p_code?: string }; Returns: undefined }
      start_game: { Args: { p_drop_id: string }; Returns: undefined }
      submit_shakes: { Args: { p_drop_id: string; p_count: number }; Returns: number }
      finish_game: { Args: { p_drop_id: string }; Returns: GameState }
      is_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: { drop_type: DropType; drop_status: DropStatus }
    CompositeTypes: Record<string, never>
  }
}

type PublicTables = Database['public']['Tables']
export type PlayerRow = PublicTables['players']['Row']
export type DropRow = PublicTables['drops']['Row']
export type NewDrop = PublicTables['drops']['Insert']
export type ClaimRow = PublicTables['claims']['Row']
export type PlayerScoreRow = Database['public']['Views']['player_scores']['Row']
