import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type FlexibleRow = Record<string, unknown>;

type AdminDatabase = {
  public: {
    Tables: Record<
      string,
      {
        Row: FlexibleRow;
        Insert: FlexibleRow;
        Update: FlexibleRow;
        Relationships: [];
      }
    >;
    Views: Record<string, never>;
    Functions: Record<
      string,
      {
        Args: FlexibleRow;
        Returns: unknown;
      }
    >;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let adminClient: SupabaseClient<AdminDatabase> | null = null;

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase server credentials are not configured.");
  }

  adminClient ??= createClient<AdminDatabase>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}
