export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          label: string
          metadata: Json
          organization_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          label: string
          metadata?: Json
          organization_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          label?: string
          metadata?: Json
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blackout_periods: {
        Row: {
          block_type: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          organization_id: string
          reason: string | null
          recurrence_rule: string | null
          starts_at: string
          technician_id: string
          updated_at: string
        }
        Insert: {
          block_type?: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          organization_id: string
          reason?: string | null
          recurrence_rule?: string | null
          starts_at: string
          technician_id: string
          updated_at?: string
        }
        Update: {
          block_type?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          organization_id?: string
          reason?: string | null
          recurrence_rule?: string | null
          starts_at?: string
          technician_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blackout_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blackout_periods_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          archived_at: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          customer_type: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          preferred_contact: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          preferred_contact?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_type?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          preferred_contact?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          created_at: string
          estimate_number: number
          expires_at: string | null
          id: string
          job_id: string | null
          organization_id: string
          status: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          estimate_number?: number
          expires_at?: string | null
          id?: string
          job_id?: string | null
          organization_id: string
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          estimate_number?: number
          expires_at?: string | null
          id?: string
          job_id?: string | null
          organization_id?: string
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          archived_at: string | null
          category: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          quantity_on_hand: number
          reorder_point: number
          sku: string | null
          unit: string
          unit_cost_cents: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          quantity_on_hand?: number
          reorder_point?: number
          sku?: string | null
          unit?: string
          unit_cost_cents?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          quantity_on_hand?: number
          reorder_point?: number
          sku?: string | null
          unit?: string
          unit_cost_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          balance_due_cents: number
          created_at: string
          diagnostic_credit_cents: number
          due_at: string | null
          id: string
          invoice_number: number
          job_id: string | null
          organization_id: string
          paid_at: string | null
          status: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          balance_due_cents?: number
          created_at?: string
          diagnostic_credit_cents?: number
          due_at?: string | null
          id?: string
          invoice_number?: number
          job_id?: string | null
          organization_id: string
          paid_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          balance_due_cents?: number
          created_at?: string
          diagnostic_credit_cents?: number
          due_at?: string | null
          id?: string
          invoice_number?: number
          job_id?: string | null
          organization_id?: string
          paid_at?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          ai_summary: string | null
          archived_at: string | null
          arrival_window_end: string | null
          arrival_window_start: string | null
          category: string
          created_at: string
          created_by: string | null
          customer_description: string | null
          customer_id: string | null
          diagnostic_fee_cents: number
          diagnostic_paid: boolean
          id: string
          job_number: number
          organization_id: string
          priority: string
          property_id: string | null
          route_locked: boolean
          safety_flags: string[]
          scheduled_end: string | null
          scheduled_start: string | null
          status: string
          technician_id: string | null
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          archived_at?: string | null
          arrival_window_end?: string | null
          arrival_window_start?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          customer_description?: string | null
          customer_id?: string | null
          diagnostic_fee_cents?: number
          diagnostic_paid?: boolean
          id?: string
          job_number?: number
          organization_id: string
          priority?: string
          property_id?: string | null
          route_locked?: boolean
          safety_flags?: string[]
          scheduled_end?: string | null
          scheduled_start?: string | null
          status?: string
          technician_id?: string | null
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          archived_at?: string | null
          arrival_window_end?: string | null
          arrival_window_start?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          customer_description?: string | null
          customer_id?: string | null
          diagnostic_fee_cents?: number
          diagnostic_paid?: boolean
          id?: string
          job_number?: number
          organization_id?: string
          priority?: string
          property_id?: string | null
          route_locked?: boolean
          safety_flags?: string[]
          scheduled_end?: string | null
          scheduled_start?: string | null
          status?: string
          technician_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_technician_id_fkey"
            columns: ["technician_id"]
            isOneToOne: false
            referencedRelation: "technicians"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          archived_at: string | null
          base_city: string | null
          base_state: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          base_city?: string | null
          base_state?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          base_city?: string | null
          base_state?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          access_notes: string | null
          address_line_1: string
          address_line_2: string | null
          archived_at: string | null
          city: string
          created_at: string
          customer_id: string
          id: string
          label: string
          latitude: number | null
          longitude: number | null
          organization_id: string
          panel_location: string | null
          panel_manufacturer: string | null
          postal_code: string
          safety_notes: string | null
          service_amperage: number | null
          state: string
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          address_line_1: string
          address_line_2?: string | null
          archived_at?: string | null
          city: string
          created_at?: string
          customer_id: string
          id?: string
          label?: string
          latitude?: number | null
          longitude?: number | null
          organization_id: string
          panel_location?: string | null
          panel_manufacturer?: string | null
          postal_code: string
          safety_notes?: string | null
          service_amperage?: number | null
          state: string
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          address_line_1?: string
          address_line_2?: string | null
          archived_at?: string | null
          city?: string
          created_at?: string
          customer_id?: string
          id?: string
          label?: string
          latitude?: number | null
          longitude?: number | null
          organization_id?: string
          panel_location?: string | null
          panel_manufacturer?: string | null
          postal_code?: string
          safety_notes?: string | null
          service_amperage?: number | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      service_settings: {
        Row: {
          after_hours_fee_cents: number
          automatic_booking_radius_miles: number
          cancellation_fee_cents: number
          created_at: string
          credit_diagnostic_to_repair: boolean
          diagnostic_fee_cents: number
          diagnostic_minutes: number
          emergency_fee_cents: number
          free_reschedule_hours: number
          id: string
          minimum_travel_buffer_minutes: number
          operational_buffer_minutes: number
          organization_id: string
          payment_required_to_confirm: boolean
          standard_pricing_radius_miles: number
          updated_at: string
        }
        Insert: {
          after_hours_fee_cents?: number
          automatic_booking_radius_miles?: number
          cancellation_fee_cents?: number
          created_at?: string
          credit_diagnostic_to_repair?: boolean
          diagnostic_fee_cents?: number
          diagnostic_minutes?: number
          emergency_fee_cents?: number
          free_reschedule_hours?: number
          id?: string
          minimum_travel_buffer_minutes?: number
          operational_buffer_minutes?: number
          organization_id: string
          payment_required_to_confirm?: boolean
          standard_pricing_radius_miles?: number
          updated_at?: string
        }
        Update: {
          after_hours_fee_cents?: number
          automatic_booking_radius_miles?: number
          cancellation_fee_cents?: number
          created_at?: string
          credit_diagnostic_to_repair?: boolean
          diagnostic_fee_cents?: number
          diagnostic_minutes?: number
          emergency_fee_cents?: number
          free_reschedule_hours?: number
          id?: string
          minimum_travel_buffer_minutes?: number
          operational_buffer_minutes?: number
          organization_id?: string
          payment_required_to_confirm?: boolean
          standard_pricing_radius_miles?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_product_selections: {
        Row: {
          archived_at: string | null
          availability: string
          created_at: string
          id: string
          job_id: string | null
          job_reference: string | null
          material_name: string
          organization_id: string
          product_name: string
          product_url: string
          quantity: number
          retailer_sku: string | null
          store_address: string | null
          store_name: string | null
          store_number: string | null
          supplier: string
          unit_price_cents: number
          updated_at: string
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          archived_at?: string | null
          availability?: string
          created_at?: string
          id?: string
          job_id?: string | null
          job_reference?: string | null
          material_name: string
          organization_id: string
          product_name: string
          product_url: string
          quantity?: number
          retailer_sku?: string | null
          store_address?: string | null
          store_name?: string | null
          store_number?: string | null
          supplier: string
          unit_price_cents: number
          updated_at?: string
          verified_at: string
          verified_by?: string | null
        }
        Update: {
          archived_at?: string | null
          availability?: string
          created_at?: string
          id?: string
          job_id?: string | null
          job_reference?: string | null
          material_name?: string
          organization_id?: string
          product_name?: string
          product_url?: string
          quantity?: number
          retailer_sku?: string | null
          store_address?: string | null
          store_name?: string | null
          store_number?: string | null
          supplier?: string
          unit_price_cents?: number
          updated_at?: string
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_selections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_product_selections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      technicians: {
        Row: {
          color: string
          created_at: string
          display_name: string
          end_location_type: string
          id: string
          is_active: boolean
          organization_id: string
          phone: string | null
          skills: string[]
          start_location_type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          display_name: string
          end_location_type?: string
          id?: string
          is_active?: boolean
          organization_id: string
          phone?: string | null
          skills?: string[]
          start_location_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          display_name?: string
          end_location_type?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          phone?: string | null
          skills?: string[]
          start_location_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "technicians_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_numbers: {
        Row: {
          created_at: string
          forward_to_number: string | null
          id: string
          label: string | null
          organization_id: string
          phone_number: string
          sms_enabled: boolean
          updated_at: string
          voice_enabled: boolean
        }
        Insert: {
          created_at?: string
          forward_to_number?: string | null
          id?: string
          label?: string | null
          organization_id: string
          phone_number: string
          sms_enabled?: boolean
          updated_at?: string
          voice_enabled?: boolean
        }
        Update: {
          created_at?: string
          forward_to_number?: string | null
          id?: string
          label?: string | null
          organization_id?: string
          phone_number?: string
          sms_enabled?: boolean
          updated_at?: string
          voice_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "inbound_numbers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_conversations: {
        Row: {
          contact_name: string | null
          contact_phone: string
          created_at: string
          customer_id: string | null
          id: string
          last_channel: Database["public"]["Enums"]["inbound_channel"]
          last_message_at: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          customer_id?: string | null
          id?: string
          last_channel: Database["public"]["Enums"]["inbound_channel"]
          last_message_at?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          customer_id?: string | null
          id?: string
          last_channel?: Database["public"]["Enums"]["inbound_channel"]
          last_message_at?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_messages: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["inbound_channel"]
          conversation_id: string
          created_at: string
          id: string
          organization_id: string
          provider_message_id: string | null
          role: string
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["inbound_channel"]
          conversation_id: string
          created_at?: string
          id?: string
          organization_id: string
          provider_message_id?: string | null
          role: string
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["inbound_channel"]
          conversation_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          provider_message_id?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbound_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_calls: {
        Row: {
          conversation_id: string | null
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          ended_reason: string | null
          from_number: string
          id: string
          organization_id: string
          provider: string
          provider_call_id: string
          recording_url: string | null
          started_at: string | null
          status: string
          summary: string | null
          to_number: string
          transcript: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          from_number: string
          id?: string
          organization_id: string
          provider: string
          provider_call_id: string
          recording_url?: string | null
          started_at?: string | null
          status: string
          summary?: string | null
          to_number: string
          transcript?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          ended_reason?: string | null
          from_number?: string
          id?: string
          organization_id?: string
          provider?: string
          provider_call_id?: string
          recording_url?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          to_number?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbound_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_leads: {
        Row: {
          call_id: string | null
          captured_by: string
          channel: Database["public"]["Enums"]["inbound_channel"]
          contact_email: string | null
          contact_name: string | null
          contact_phone: string
          conversation_id: string | null
          converted_job_id: string | null
          created_at: string
          id: string
          job_type: string | null
          organization_id: string
          preferred_times: string | null
          service_address: string | null
          status: Database["public"]["Enums"]["lead_status"]
          summary: string
          updated_at: string
          urgency: Database["public"]["Enums"]["lead_urgency"]
        }
        Insert: {
          call_id?: string | null
          captured_by?: string
          channel: Database["public"]["Enums"]["inbound_channel"]
          contact_email?: string | null
          contact_name?: string | null
          contact_phone: string
          conversation_id?: string | null
          converted_job_id?: string | null
          created_at?: string
          id?: string
          job_type?: string | null
          organization_id: string
          preferred_times?: string | null
          service_address?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          summary: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["lead_urgency"]
        }
        Update: {
          call_id?: string | null
          captured_by?: string
          channel?: Database["public"]["Enums"]["inbound_channel"]
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string
          conversation_id?: string | null
          converted_job_id?: string | null
          created_at?: string
          id?: string
          job_type?: string | null
          organization_id?: string
          preferred_times?: string | null
          service_address?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          summary?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["lead_urgency"]
        }
        Relationships: [
          {
            foreignKeyName: "inbound_leads_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "inbound_calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_leads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "inbound_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_leads_converted_job_id_fkey"
            columns: ["converted_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      inbound_channel: "voice" | "sms"
      lead_status: "new" | "contacted" | "scheduled" | "converted" | "closed"
      lead_urgency: "emergency" | "urgent" | "routine" | "unknown"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
