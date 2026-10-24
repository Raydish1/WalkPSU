// Hand-written to match supabase/migrations. Keep in sync with every migration.
// (Or regenerate: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts)

export type DropType = 'minigame' | 'photo_hunt' | 'checkin'
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

type BuildingControl = { building_num: string; player_id: string; claim_id: string; captured_at: string }

type DropSecret = { drop_id: string; claim_code: string }

type PlayerScore = { player_id: string; display_name: string; color: string; points: number; claims: number; buildings: number }

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
          Partial<Pick<Drop, 'points' | 'status' | 'hint_photo_url' | 'building_num' | 'created_by' | 'expires_at'>>
        Update: Partial<Omit<Drop, 'id' | 'created_at'>>
        Relationships: []
      }
      claims: { Row: Claim; Insert: never; Update: never; Relationships: [] }
      building_control: { Row: BuildingControl; Insert: never; Update: never; Relationships: [] }
      drop_secrets: { Row: DropSecret; Insert: never; Update: never; Relationships: [] }
    }
    Views: {
      player_scores: { Row: PlayerScore; Relationships: [] }
    }
    Functions: {
      claim_drop: { Args: { p_drop_id: string; p_lat?: number; p_lng?: number; p_code?: string }; Returns: Claim }
      claim_radius_m: { Args: Record<string, never>; Returns: number }
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
export type BuildingControlRow = PublicTables['building_control']['Row']
export type PlayerScoreRow = Database['public']['Views']['player_scores']['Row']
