import type { SupabaseClient } from "@supabase/supabase-js";

type FlexibleRow = Record<string, unknown>;

type FlexibleDatabase = {
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

export type FlexibleSupabaseClient = SupabaseClient<FlexibleDatabase>;

export function asFlexibleClient(client: unknown) {
  return client as FlexibleSupabaseClient;
}
