// Hand-written to match supabase/migrations. Keep in sync with every migration.
// (Or regenerate: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts)

export type DropType = 'minigame' | 'photo_hunt' | 'checkin' | 'meetup'
export type DropStatus = 'active' | 'claimed' | 'expired'
/** Which mini-game a 'minigame' drop runs. */
export type MinigameKind = 'shake_off' | 'quick_draw' | 'needle_rain'

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
  lat: number
  lng: number
  points: number
  status: DropStatus
  hint_photo_url: string | null
  /** Photo hunts: what the player's photo must also show, e.g. "with a thumbs up". */
  twist: string | null
  /** Photo hunts: until first_found_at, lat/lng is the center of a circle this big around the hidden spot. */
  search_radius_m: number | null
  /** Photo hunts: when the first player found it. From then on, lat/lng is the exact spot. */
  first_found_at: string | null
  building_num: string | null
  created_by: string | null
  created_at: string
  expires_at: string | null
  /** Shown under the title, e.g. the hosting organization of an imported campus event. */
  subtitle: string | null
  /** When the event behind the drop begins. null for drops made in /admin. */
  starts_at: string | null
  /** Set only on drops seeded from campus events (e.g. 'discover:12893409'), so they can be cleared. */
  source_id: string | null
  /** 'minigame' drops only (null otherwise): which game its lobby plays. */
  game: MinigameKind | null
}

type Claim = { id: string; drop_id: string; player_id: string; points: number; created_at: string }

type DropSecret = {
  drop_id: string
  claim_code: string
  hunt_lat: number | null
  hunt_lng: number | null
  hunt_building_num: string | null
}

export type Side = 'blue' | 'white'

type Game = {
  drop_id: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  winner_side: Side | null
  /** Needle Rain: the one player who is paid. Null for side-based games. */
  winner_id: string | null
  /** Public once the round is scheduled. Null in the lobby, so a practice run can't see the real storm. */
  round_seed: string | null
  /** Practice-run pattern. Never the live round seed. */
  ghost_seed: string
  ghost_dodges: number | null
  ghost_player_id: string | null
  ghost_name: string | null
}

type GamePlayerRow = { drop_id: string; player_id: string; joined_at: string; shakes: number; dodges: number; eliminated: boolean }

/** Mirrors SQL shake_off_settings(); the server is the only source of these numbers. */
export type ShakeOffSettings = {
  game_seconds: number
  auto_start_players: number
  auto_start_delay_seconds: number
  admin_start_delay_seconds: number
  max_shakes_per_second: number
  submit_grace_seconds: number
}

/** Timed games' extra settings (Quick Draw). Lower round values win. */
export type TimedSettings = {
  rounds: number
  round_seconds: number
  min_signal_delay_ms: number
  max_signal_delay_ms: number
  min_reaction_ms: number
  max_reaction_ms: number
  clock_tolerance_ms: number
}

/** Needle Rain's own numbers, merged onto the shared lobby settings by minigame_settings('needle_rain'). */
export type NeedleRainSettings = ShakeOffSettings & { max_dodges_per_second: number }

/** Mirrors SQL minigame_settings(kind): the shared lobby settings plus the kind's own (game_seconds per kind). */
export type MinigameSettings = ShakeOffSettings & Partial<TimedSettings> & Partial<Pick<NeedleRainSettings, 'max_dodges_per_second'>>

/** One round of a timed game. Quick Draw: `signal_at` is when every phone shows "DRAW!". */
export type GameRound = { round: number; starts_at: string; signal_at: string }

/** A player's result for one round. Quick Draw: `value` is the reaction in ms; null with false_start = too early. */
export type RoundResult = { player_id: string; round: number; value: number | null; false_start: boolean }

type GameResultRow = RoundResult & { drop_id: string; created_at: string }

export type GamePlayer = {
  player_id: string
  display_name: string
  color: string
  side: Side | null
  shakes: number
  dodges: number
  eliminated: boolean
  joined_at: string
}

/** Returned by get_game_state() and finish_game(). `game` is null until someone joins. */
export type GameState = {
  server_now: string
  kind: MinigameKind
  settings: MinigameSettings
  game: Game | null
  players: GamePlayer[]
  /** Timed games, once a start is set. Empty for a Shake-Off. */
  rounds: GameRound[]
  results: RoundResult[]
}

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
          Partial<
            Pick<Drop, 'points' | 'status' | 'hint_photo_url' | 'building_num' | 'created_by' | 'expires_at' | 'subtitle' | 'starts_at' | 'source_id' | 'game'>
          >
        Update: Partial<Omit<Drop, 'id' | 'created_at'>>
        Relationships: []
      }
      claims: { Row: Claim; Insert: never; Update: never; Relationships: [] }
      drop_secrets: { Row: DropSecret; Insert: never; Update: never; Relationships: [] }
      games: { Row: Game & { seed: string }; Insert: never; Update: never; Relationships: [] }
      game_players: { Row: GamePlayerRow; Insert: never; Update: never; Relationships: [] }
      game_results: { Row: GameResultRow; Insert: never; Update: never; Relationships: [] }
      /** Fog-of-war: hexes (web/src/map/hexgrid.ts ids, "q:r") a player has walked into. Own rows only. */
      discovered_areas: { Row: { player_id: string; hex_id: string }; Insert: { player_id: string; hex_id: string }; Update: never; Relationships: [] }
    }
    Views: {
      player_scores: { Row: PlayerScore; Relationships: [] }
    }
    Functions: {
      claim_drop: { Args: { p_drop_id: string; p_lat?: number; p_lng?: number; p_code?: string }; Returns: Claim }
      claim_radius_m: { Args: Record<string, never>; Returns: number }
      create_photo_hunt: {
        Args: {
          p_title: string
          p_lat: number
          p_lng: number
          p_hint_photo_url: string
          p_twist: string
          p_points?: number
          p_building_num?: string | null
          p_expires_at?: string | null
        }
        Returns: Drop
      }
      current_player_id: { Args: Record<string, never>; Returns: string | null }
      /** Any player: a social pin at their position (no points). Replaces their previous live meetup. */
      create_meetup: { Args: { p_text: string; p_lat: number; p_lng: number; p_minutes?: number; p_building_num?: string | null }; Returns: Drop }
      /** Admins: any drop. Players: a meetup they started. Marks it expired; earned points stay. */
      close_drop: { Args: { p_drop_id: string }; Returns: undefined }
      /** True if the area is new for the caller, false if already discovered. */
      discover_area: { Args: { p_hex_id: string }; Returns: boolean }
      /** Service role only. */
      photo_hunt_check: { Args: { p_drop_id: string; p_player_id: string; p_lat: number; p_lng: number }; Returns: Drop }
      /** Service role only. */
      claim_photo_hunt: { Args: { p_drop_id: string; p_player_id: string; p_lat: number; p_lng: number }; Returns: Claim }
      get_game_state: { Args: { p_drop_id: string }; Returns: GameState }
      join_game: { Args: { p_drop_id: string; p_lat?: number; p_lng?: number; p_code?: string }; Returns: undefined }
      start_game: { Args: { p_drop_id: string }; Returns: undefined }
      submit_shakes: { Args: { p_drop_id: string; p_count: number }; Returns: number }
      /** Needle Rain. The server caps the count and freezes it once p_eliminated is true. */
      submit_dodges: { Args: { p_drop_id: string; p_count: number; p_eliminated?: boolean }; Returns: number }
      /** Solo practice. Stores a capped dodge count, pays nothing, and does not finish the drop. */
      submit_ghost: { Args: { p_drop_id: string; p_count: number }; Returns: number }
      /** Quick Draw. p_reaction_ms omitted = flicked before the signal. */
      submit_reaction: { Args: { p_drop_id: string; p_round: number; p_reaction_ms?: number }; Returns: GameResultRow }
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
