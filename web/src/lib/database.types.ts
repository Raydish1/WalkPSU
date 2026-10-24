// Hand-written to match supabase/migrations. Keep in sync with every migration.
// (Or regenerate: npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts)

export type DropType = 'minigame' | 'photo_hunt' | 'checkin'
export type DropStatus = 'active' | 'claimed' | 'expired'

type Team = { id: string; name: string; color: string }

type Player = {
  id: string
  auth_id: string
  display_name: string
  team_id: string
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
  created_by: string | null
  created_at: string
  expires_at: string | null
}

type Claim = { id: string; drop_id: string; player_id: string; team_id: string; created_at: string }

type TeamScore = { team_id: string; name: string; color: string; points: number; claims: number }

export type Database = {
  public: {
    Tables: {
      teams: { Row: Team; Insert: Omit<Team, 'id'> & { id?: string }; Update: Partial<Team>; Relationships: [] }
      players: {
        Row: Player
        Insert: Pick<Player, 'display_name' | 'team_id'>
        Update: Partial<Pick<Player, 'display_name' | 'team_id'>>
        Relationships: []
      }
      drops: {
        Row: Drop
        Insert: Pick<Drop, 'title' | 'type' | 'lat' | 'lng'> &
          Partial<Pick<Drop, 'points' | 'status' | 'hint_photo_url' | 'created_by' | 'expires_at'>>
        Update: Partial<Omit<Drop, 'id' | 'created_at'>>
        Relationships: []
      }
      claims: { Row: Claim; Insert: never; Update: never; Relationships: [] }
    }
    Views: {
      team_scores: { Row: TeamScore; Relationships: [] }
    }
    Functions: {
      claim_drop: { Args: { p_drop_id: string; p_lat: number; p_lng: number }; Returns: Claim }
      is_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: { drop_type: DropType; drop_status: DropStatus }
    CompositeTypes: Record<string, never>
  }
}

type PublicTables = Database['public']['Tables']
export type TeamRow = PublicTables['teams']['Row']
export type PlayerRow = PublicTables['players']['Row']
export type DropRow = PublicTables['drops']['Row']
export type NewDrop = PublicTables['drops']['Insert']
export type ClaimRow = PublicTables['claims']['Row']
export type TeamScoreRow = Database['public']['Views']['team_scores']['Row']
