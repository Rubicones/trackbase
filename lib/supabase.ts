import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

// ---- Types ----------------------------------------------------------------

export interface Band {
  id: string
  name: string
  created_at: string
}

export interface Project {
  id: string
  band_id: string
  name: string
  bpm: number | null
  key: string | null
  created_at: string
  updated_at: string
}

export interface Version {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  type: 'main' | 'branch'
  created_by: string | null
  created_at: string
  merged_at: string | null
}

export interface Track {
  id: string
  version_id: string
  name: string
  original_filename: string | null
  file_hash: string
  storage_path: string
  duration_ms: number | null
  file_size_bytes: number | null
  position: number
  created_at: string
}
