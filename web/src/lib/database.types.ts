// Generated from the Supabase schema (generic helpers condensed). Regenerate after migrations; do not edit by hand.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type OrderRow = {
  access_token: string
  closed_at: string | null
  closed_by: string | null
  closed_reason: string | null
  completed_at: string | null
  confirmed_at: string | null
  confirmed_by: string | null
  confirmed_due_at: string | null
  created_at: string
  created_by: string | null
  customer_id: string | null
  customer_name: string | null
  customer_notes: string | null
  customer_phone: string | null
  discount_by: string | null
  discount_paise: number
  discount_reason: string | null
  due_at: string | null
  fulfilment: Database["public"]["Enums"]["fulfilment_type"]
  id: string
  idempotency_key: string
  internal_notes: string | null
  is_immediate: boolean
  order_number: number
  reference: string | null
  requested_due_at: string
  setup_address: string | null
  setup_note: string | null
  source: Database["public"]["Enums"]["order_source"]
  status: Database["public"]["Enums"]["order_status"]
  subtotal_paise: number
  tax_paise: number
  total_paise: number
  updated_at: string
  version: number
}

type PaymentRow = {
  amount_paise: number
  id: string
  idempotency_key: string
  kind: Database["public"]["Enums"]["payment_kind"]
  method: Database["public"]["Enums"]["payment_method"]
  note: string | null
  order_id: string
  paid_at: string
  recorded_at: string
  recorded_by: string | null
  reference: string | null
}

type BillRow = {
  bill_number: string
  business: Json
  cgst_paise: number
  customer_name: string | null
  customer_phone: string | null
  discount_paise: number
  financial_year: string
  id: string
  issued_at: string
  issued_by: string | null
  lines: Json
  order_id: string
  sequence_number: number
  sgst_paise: number
  subtotal_paise: number
  taxable_paise: number
  total_paise: number
}

type CreditNoteRow = {
  bill_id: string
  cgst_paise: number
  credit_note_number: string
  financial_year: string
  id: string
  idempotency_key: string
  issued_at: string
  issued_by: string | null
  reason: string
  sequence_number: number
  sgst_paise: number
  taxable_paise: number
  total_paise: number
}

type Nullable<T> = { [K in keyof T]: T[K] | null }
type RpcReturnsOrder = {
  Returns: OrderRow
  SetofOptions: { from: "*"; to: "orders"; isOneToOne: true; isSetofReturn: false }
}

type KitchenTicketRow = {
  acknowledged_at: string | null
  acknowledged_by: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  changes_acknowledged_at: string | null
  changes_acknowledged_by: string | null
  created_at: string
  due_at: string
  has_pending_changes: boolean
  id: string
  kitchen_id: string
  order_id: string
  pending_changes: Json
  print_count: number
  ready_at: string | null
  ready_by: string | null
  reference: string
  revised_at: string | null
  revision: number
  source: Database["public"]["Enums"]["order_source"]
  start_by: string
  started_at: string | null
  started_by: string | null
  status: Database["public"]["Enums"]["ticket_status"]
  stop_work_acknowledged_at: string | null
  stop_work_acknowledged_by: string | null
  updated_at: string
}

type KitchenIssueRow = {
  id: string
  kind: string
  line_id: string | null
  note: string
  reported_at: string
  reported_by: string | null
  resolution: string | null
  resolved_at: string | null
  resolved_by: string | null
  ticket_id: string
}

type RpcReturnsTicket = {
  Returns: KitchenTicketRow
  SetofOptions: { from: "*"; to: "kitchen_tickets"; isOneToOne: true; isSetofReturn: false }
}

type RpcReturnsIssue = {
  Returns: KitchenIssueRow
  SetofOptions: { from: "*"; to: "kitchen_issues"; isOneToOne: true; isSetofReturn: false }
}

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      business_hours: {
        Row: {
          closes_at: string
          is_closed: boolean
          opens_at: string
          updated_at: string
          weekday: number
        }
        Insert: {
          closes_at: string
          is_closed?: boolean
          opens_at: string
          updated_at?: string
          weekday: number
        }
        Update: {
          closes_at?: string
          is_closed?: boolean
          opens_at?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: []
      }
      business_settings: {
        Row: {
          address: string | null
          bill_prefix: string
          business_name: string
          counter_discount_limit_bps: number
          currency: string
          custom_cake_hsn_code: string | null
          custom_cake_tax_rate_bps: number
          email: string | null
          fssai_licence: string | null
          gstin: string | null
          id: boolean
          phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_name?: string
          currency?: string
          email?: string | null
          fssai_licence?: string | null
          gstin?: string | null
          id?: boolean
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          bill_prefix?: string
          counter_discount_limit_bps?: number
          custom_cake_hsn_code?: string | null
          custom_cake_tax_rate_bps?: number
          business_name?: string
          currency?: string
          email?: string | null
          fssai_licence?: string | null
          gstin?: string | null
          id?: boolean
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          default_kitchen_id: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_kitchen_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_kitchen_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_default_kitchen_id_fkey"
            columns: ["default_kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
        ]
      }
      gallery_photos: {
        Row: {
          id: string
          image_url: string
          caption: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          image_url: string
          caption?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          image_url?: string
          caption?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      offers: {
        Row: {
          id: string
          title: string
          body: string | null
          image_url: string | null
          button_label: string | null
          button_link: string | null
          starts_on: string | null
          ends_on: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          body?: string | null
          image_url?: string | null
          button_label?: string | null
          button_link?: string | null
          starts_on?: string | null
          ends_on?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Update: {
          title?: string
          body?: string | null
          image_url?: string | null
          button_label?: string | null
          button_link?: string | null
          starts_on?: string | null
          ends_on?: string | null
          is_active?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          id: string
          customer_name: string
          rating: number
          comment: string
          status: "pending" | "approved" | "hidden"
          decided_at: string | null
          decided_by: string | null
          created_at: string
        }
        // Reviews arrive only through submit_review; staff change the status.
        Insert: never
        Update: { status?: "pending" | "approved" | "hidden" }
        Relationships: []
      }
      bills: {
        Row: BillRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "bills_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_overrides: {
        Row: {
          category_id: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          kind: string
          max_orders: number | null
          note: string
          on_date: string
          starts_at: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          kind: string
          max_orders?: number | null
          note: string
          on_date: string
          starts_at?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          kind?: string
          max_orders?: number | null
          note?: string
          on_date?: string
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capacity_overrides_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_daily_caps: {
        Row: {
          category_id: string
          max_orders: number
          updated_at: string
        }
        Insert: {
          category_id: string
          max_orders: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          max_orders?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_daily_caps_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: true
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_windows: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          max_orders: number | null
          starts_at: string
          weekday: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      credit_notes: {
        Row: CreditNoteRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "credit_notes_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      closures: {
        Row: {
          closed_on: string
          created_at: string
          reason: string
        }
        Insert: {
          closed_on: string
          created_at?: string
          reason: string
        }
        Update: {
          closed_on?: string
          created_at?: string
          reason?: string
        }
        Relationships: []
      }
      customer_events: {
        Row: {
          actor_id: string | null
          customer_id: string
          event_type: "blocked" | "unblocked"
          id: number
          occurred_at: string
          reason: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "customer_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_cakes: {
        Row: {
          addon_charge_item_id: string | null
          addon_charge_paise: number
          addon_details: string | null
          created_at: string
          cream: string | null
          delivery_charge_item_id: string | null
          delivery_charge_paise: number
          design: string | null
          filling: string | null
          flavour: string
          fondant: string | null
          has_cupcakes: boolean
          has_popsicles: boolean
          cupcake_count: number
          popsicle_count: number
          id: string
          instructions: string | null
          is_eggless: boolean
          message: string | null
          model: string | null
          order_id: string
          order_item_id: string
          photo_paths: string[]
          setup_charge_item_id: string | null
          setup_charge_paise: number
          theme: string | null
          tiers: number
          toppings: string | null
          updated_at: string
          weight_kg: number
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "custom_cakes_delivery_charge_item_id_fkey"
            columns: ["delivery_charge_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_cakes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_cakes_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_cakes_setup_charge_item_id_fkey"
            columns: ["setup_charge_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          blocked_reason: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_blocked: boolean
          no_show_count: number
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          blocked_reason?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_blocked?: boolean
          no_show_count?: number
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          blocked_reason?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_blocked?: boolean
          no_show_count?: number
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      kitchen_issues: {
        Row: KitchenIssueRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_issues_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "kitchen_ticket_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_issues_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "kitchen_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_devices: {
        Row: {
          failed_pins: number
          id: string
          kitchen_id: string
          label: string
          last_used_at: string | null
          registered_at: string
          registered_by: string | null
          revoked_at: string | null
          revoked_by: string | null
          token_hash: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_devices_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_pins: {
        Row: { pin_hash: string; set_at: string; set_by: string | null; user_id: string }
        Insert: never
        Update: never
        Relationships: []
      }
      kitchen_ticket_lines: {
        Row: {
          allergens: string[]
          contains_egg: boolean
          id: string
          is_eggless: boolean
          is_veg: boolean | null
          lead_time_minutes: number
          line_no: number
          notes: string | null
          order_item_id: string | null
          product_name: string
          quantity: number
          ready_quantity: number
          status: Database["public"]["Enums"]["ticket_line_status"]
          ticket_id: string
          variant_name: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_ticket_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_ticket_lines_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "kitchen_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_tickets: {
        Row: KitchenTicketRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_tickets_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchens: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      order_events: {
        Row: {
          actor_id: string | null
          data: Json
          event_type: string
          id: number
          occurred_at: string
          order_id: string
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          data?: Json
          event_type: string
          id?: never
          occurred_at?: string
          order_id: string
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          data?: Json
          event_type?: string
          id?: never
          occurred_at?: string
          order_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          allergens: string[]
          cancelled_quantity: number
          category_id: string | null
          contains_egg: boolean
          created_at: string
          discount_paise: number
          hsn_code: string | null
          id: string
          is_eggless: boolean
          is_veg: boolean | null
          kitchen_id: string | null
          lead_time_minutes: number
          line_no: number
          line_total_paise: number
          notes: string | null
          order_id: string
          prep_type: Database["public"]["Enums"]["prep_type"]
          product_id: string | null
          product_name: string
          quantity: number
          tax_paise: number
          tax_rate_bps: number
          unit_price_paise: number
          variant_id: string | null
          variant_name: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "order_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        // Columns added after OrderRow was written. The view order_summaries has them too since it was
        // recreated (20261003000500), but its type below does not list them; read them from orders.
        Row: OrderRow & {
          no_show_at: string | null
          no_show_by: string | null
          // Phase 5B packing and handover
          packed_at: string | null
          packed_by: string | null
          packing_note: string | null
          handed_over_by: string | null
          collected_by: string | null
          credit_reason: string | null
          // 2026-10-24: Kitchen 1 (custom cake orders) or Kitchen 2 (every other order); sticky note.
          kitchen_id: string | null
          sticky_note: string | null
          sticky_note_in_whatsapp: boolean
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: PaymentRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          is_available: boolean
          is_eggless: boolean
          kitchen_id: string | null
          lead_time_minutes: number
          name: string
          price_paise: number
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_available?: boolean
          is_eggless?: boolean
          kitchen_id?: string | null
          lead_time_minutes?: number
          name: string
          price_paise: number
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          is_available?: boolean
          is_eggless?: boolean
          kitchen_id?: string | null
          lead_time_minutes?: number
          name?: string
          price_paise?: number
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          allergens: string[]
          archived_at: string | null
          category_id: string
          contains_egg: boolean
          created_at: string
          description: string | null
          hsn_code: string | null
          id: string
          image_url: string | null
          is_available: boolean
          is_veg: boolean | null // food type removed 2026-10-24; old rows keep it, new rows have null
          name: string
          prep_type: Database["public"]["Enums"]["prep_type"]
          tax_rate_bps: number
          updated_at: string
        }
        Insert: {
          allergens?: string[]
          archived_at?: string | null
          category_id: string
          contains_egg?: boolean
          created_at?: string
          description?: string | null
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_veg?: boolean | null
          name: string
          prep_type?: Database["public"]["Enums"]["prep_type"]
          tax_rate_bps?: number
          updated_at?: string
        }
        Update: {
          allergens?: string[]
          archived_at?: string | null
          category_id?: string
          contains_egg?: boolean
          created_at?: string
          description?: string | null
          hsn_code?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_veg?: boolean | null
          name?: string
          prep_type?: Database["public"]["Enums"]["prep_type"]
          tax_rate_bps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_kitchens: {
        Row: {
          created_at: string
          kitchen_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          kitchen_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          kitchen_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_kitchens_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_kitchens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      quotation_sends: {
        Row: {
          caption: string | null
          channel: string
          file_path: string | null
          format: string
          id: string
          message_id: string | null
          order_id: string
          sent_at: string
          sent_by: string | null
          status: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "quotation_sends_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_jobs: {
        Row: {
          attempts: number
          caption: string | null
          created_at: string
          created_by: string | null
          document: string
          file_name: string
          file_path: string
          format: string
          id: string
          message_id: string | null
          order_id: string
          problem: string | null
          status: string
          to_phone: string
          updated_at: string
        }
        Insert: {
          caption?: string | null
          document: string
          file_name: string
          file_path: string
          format: string
          order_id: string
          to_phone: string
        }
        Update: never
        Relationships: []
      }
      whatsapp_sender: {
        Row: {
          id: number
          last_seen: string | null
          linked_phone: string | null
          state: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      terms_sends: {
        Row: {
          delivery_problem: string | null
          delivery_status: string | null
          delivery_updated_at: string | null
          format: string
          id: string
          message_id: string | null
          order_id: string
          problem: string | null
          sent_at: string
          sent_by: string | null
          status: string
          test_mode: boolean
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "terms_sends_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          full_name: string
          is_active: boolean
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name: string
          is_active?: boolean
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      order_kitchen_progress: {
        Row: {
          all_ready: boolean | null
          changes_pending: number | null
          open_issues: number | null
          order_id: string | null
          ready_count: number | null
          stop_work_pending: number | null
          ticket_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_summaries: {
        Row: Nullable<OrderRow> & {
          balance_paise: number | null
          bill_id: string | null
          bill_number: string | null
          credited_paise: number | null
          item_count: number | null
          kitchen_ids: string[] | null
          paid_paise: number | null
          refunded_paise: number | null
          kitchen_id: string | null
          sticky_note: string | null
          sticky_note_in_whatsapp: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      unmapped_variants: {
        Row: {
          product_id: string | null
          product_name: string | null
          variant_id: string | null
          variant_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_stop_work: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
      acknowledge_ticket: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
      acknowledge_ticket_changes: RpcReturnsTicket & {
        Args: { p_expected_revision?: number; p_reason?: string; p_ticket_id: string }
      }
      record_ticket_print: {
        Args: { p_ticket_id: string }
        Returns: number
      }
      report_issue: RpcReturnsIssue & {
        Args: { p_kind: string; p_line_id?: string; p_note: string; p_ticket_id: string }
      }
      resolve_issue: RpcReturnsIssue & {
        Args: { p_issue_id: string; p_resolution: string }
      }
      set_line_ready: RpcReturnsTicket & {
        Args: { p_line_id: string; p_ready_quantity: number; p_reason?: string }
      }
      start_ticket: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
      ticket_stamp: {
        Args: never
        Returns: string
      }
      set_staff_pin: {
        Args: { p_pin: string | null; p_user_id: string }
        Returns: undefined
      }
      register_kitchen_device: {
        Args: { p_kitchen_id: string; p_label: string; p_token_hash: string }
        Returns: string
      }
      revoke_kitchen_device: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      verify_kitchen_pin: {
        Args: { p_pin: string; p_token_hash: string; p_user_id: string }
        Returns: Json
      }
      kitchen_device_chefs: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      record_kitchen_pin_session: {
        Args: { p_device_id: string; p_session_id: string; p_signed_in_at: string; p_user_id: string }
        Returns: undefined
      }
      kitchen_pin_session_status: {
        Args: { p_session_id: string; p_token_hash: string }
        Returns: string
      }
      sales_report: {
        Args: { p_from: string; p_to: string }
        Returns: Json
      }
      mark_packed: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_note?: string; p_order_id: string }
      }
      reopen_packing: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_order_id: string; p_reason: string }
      }
      record_handover: RpcReturnsOrder & {
        Args: { p_collected_by?: string; p_credit_reason?: string; p_expected_version: number; p_order_id: string }
      }
      apply_discount: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_kind: string; p_order_id: string; p_reason?: string; p_value: number }
      }
      counter_sale: {
        Args: {
          p_customer_name?: string
          p_customer_phone?: string
          p_discount_kind?: string
          p_discount_reason?: string
          p_discount_value?: number
          p_idempotency_key: string
          p_items: Json
          p_payments: Json
        }
        Returns: Json
      }
      issue_bill: {
        Args: { p_order_id: string }
        Returns: BillRow
        SetofOptions: { from: "*"; to: "bills"; isOneToOne: true; isSetofReturn: false }
      }
      issue_credit_note: {
        Args: { p_amount_paise: number; p_bill_id: string; p_idempotency_key: string; p_reason: string }
        Returns: CreditNoteRow
        SetofOptions: { from: "*"; to: "credit_notes"; isOneToOne: true; isSetofReturn: false }
      }
      cancel_order: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_order_id: string; p_reason: string }
      }
      confirm_order: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_order_id: string; p_override_reason?: string }
      }
      create_order: RpcReturnsOrder & {
        Args: {
          p_confirm?: boolean
          p_customer_name?: string
          p_customer_notes?: string
          p_customer_phone?: string
          p_due_at?: string
          p_idempotency_key: string
          p_internal_notes?: string
          p_items: Json
          p_override_reason?: string
          p_source: Database["public"]["Enums"]["order_source"]
          p_fulfilment?: Database["public"]["Enums"]["fulfilment_type"]
          p_setup_address?: string
          p_setup_note?: string
        }
      }
      create_custom_cake_order: RpcReturnsOrder & {
        Args: {
          p_advance_method?: Database["public"]["Enums"]["payment_method"]
          p_advance_paise?: number
          p_advance_reference?: string
          p_cake: Json
          p_confirm?: boolean
          p_customer_name: string
          p_customer_notes?: string
          p_customer_phone: string
          p_due_at: string
          p_fulfilment?: Database["public"]["Enums"]["fulfilment_type"]
          p_idempotency_key: string
          p_internal_notes?: string
          p_override_reason?: string
          p_price_paise: number
          p_setup_address?: string
          p_setup_note?: string
          p_source: Database["public"]["Enums"]["order_source"]
        }
      }
      create_custom_cake_order_with_advance_date: RpcReturnsOrder & {
        Args: {
          p_advance_method?: Database["public"]["Enums"]["payment_method"]
          p_advance_paid_at?: string
          p_advance_paise?: number
          p_advance_reference?: string
          p_cake: Json
          p_confirm?: boolean
          p_customer_name: string
          p_customer_notes?: string
          p_customer_phone: string
          p_due_at: string
          p_fulfilment?: Database["public"]["Enums"]["fulfilment_type"]
          p_idempotency_key: string
          p_internal_notes?: string
          p_override_reason?: string
          p_price_paise: number
          p_setup_address?: string
          p_setup_note?: string
          p_source: Database["public"]["Enums"]["order_source"]
        }
      }
      update_custom_cake: RpcReturnsOrder & {
        Args: { p_cake: Json; p_expected_version: number; p_order_id: string; p_price_paise: number }
      }
      set_fulfilment: RpcReturnsOrder & {
        Args: {
          p_expected_version: number
          p_fulfilment: Database["public"]["Enums"]["fulfilment_type"]
          p_order_id: string
          p_setup_address?: string
          p_setup_note?: string
        }
      }
      set_product_image: {
        Args: { p_image_url: string | null; p_product_id: string }
        Returns: undefined
      }
      set_custom_cake_photos: {
        Args: { p_order_id: string; p_photo_paths: string[] }
        Returns: undefined
      }
      chef_work: {
        Args: { p_from: string; p_to: string }
        Returns: {
          order_id: string
          reference: string
          status: Database["public"]["Enums"]["order_status"]
          due_at: string
          is_immediate: boolean
          fulfilment: Database["public"]["Enums"]["fulfilment_type"]
          item_id: string
          line_no: number
          product_name: string
          variant_name: string
          quantity: number
          is_eggless: boolean
          notes: string | null
          kitchen_id: string | null
          kitchen_name: string | null
          image_url: string | null
          cake: Json | null
          customer_name: string | null
          customer_phone: string | null
          customer_notes: string | null
          setup_address: string | null
          setup_note: string | null
          source: Database["public"]["Enums"]["order_source"]
          internal_notes: string | null
        }[]
      }
      set_item_kitchen: {
        Args: { p_item_id: string; p_kitchen_id: string | null }
        Returns: undefined
      }
      pickup_availability: {
        Args: { p_date: string; p_exclude_order?: string }
        Returns: Json
      }
      website_catalogue: {
        Args: never
        Returns: Json
      }
      website_content: {
        Args: never
        Returns: Json
      }
      record_customer_message: {
        Args: { p_order_id: string; p_kind: string }
        Returns: undefined
      }
      order_quotation: {
        Args: { p_order_id: string }
        Returns: Json
      }
      set_sticky_note: {
        Args: { p_order_id: string; p_note: string | null; p_in_whatsapp: boolean }
        Returns: undefined
      }
      record_quotation_send: {
        Args: {
          p_order_id: string
          p_format: string
          p_channel: string
          p_status: string
          p_file_path: string | null
          p_caption?: string | null
          p_message_id?: string | null
        }
        Returns: string
      }
      record_terms_send: {
        Args: {
          p_order_id: string
          p_format: string
          p_status: string
          p_message_id?: string | null
          p_problem?: string | null
          p_test?: boolean
        }
        Returns: string
      }
      whatsapp_sender_heartbeat: {
        Args: { p_state: string; p_linked_phone?: string | null }
        Returns: undefined
      }
      claim_whatsapp_job: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Tables"]["whatsapp_jobs"]["Row"][]
      }
      finish_whatsapp_job: {
        Args: { p_job_id: string; p_status: string; p_message_id?: string | null; p_problem?: string | null }
        Returns: undefined
      }
      record_whatsapp_status: {
        Args: { p_message_id: string; p_status: string; p_problem?: string | null }
        Returns: number
      }
      delete_staff: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      delete_product: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      delete_order: {
        Args: { p_order_id: string; p_expected_version: number; p_reason: string }
        Returns: undefined
      }
      submit_review: {
        Args: { p_name: string; p_rating: number; p_comment: string }
        Returns: undefined
      }
      submit_website_order: {
        Args: {
          p_idempotency_key: string
          p_name: string
          p_phone: string
          p_due_at: string
          p_message: string | null
          p_order_type?: string | null
          p_email?: string | null
          p_items?: Json
          p_fulfilment?: Database["public"]["Enums"]["fulfilment_type"]
          p_setup_address?: string | null
          p_setup_note?: string | null
        }
        Returns: Json
      }
      set_customer_blocked: {
        Args: { p_blocked: boolean; p_customer_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["customers"]["Row"]
        SetofOptions: { from: "*"; to: "customers"; isOneToOne: true; isSetofReturn: false }
      }
      set_date_windows: {
        Args: { p_date: string; p_note: string; p_windows: Json }
        Returns: undefined
      }
      set_pickup_windows: {
        Args: { p_weekdays: number[]; p_windows: Json }
        Returns: undefined
      }
      record_no_show: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_order_id: string }
      }
      record_payment: {
        Args: {
          p_amount_paise: number
          p_idempotency_key: string
          p_kind: Database["public"]["Enums"]["payment_kind"]
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_order_id: string
          p_paid_at?: string
          p_reference?: string
        }
        Returns: PaymentRow
        SetofOptions: { from: "*"; to: "payments"; isOneToOne: true; isSetofReturn: false }
      }
      reject_order: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_order_id: string; p_reason: string }
      }
      reschedule_order: RpcReturnsOrder & {
        Args: {
          p_due_at: string
          p_expected_version: number
          p_order_id: string
          p_override_reason?: string
          p_reason: string
        }
      }
      update_order_items: RpcReturnsOrder & {
        Args: {
          p_expected_version: number
          p_lines: Json
          p_order_id: string
          p_override_reason?: string
          p_reason?: string
        }
      }
      undo_no_show: RpcReturnsOrder & {
        Args: { p_expected_version: number; p_order_id: string; p_reason: string }
      }
    }
    Enums: {
      fulfilment_type: "collect" | "setup"
      order_source: "IN_STORE" | "ONLINE" | "CALL" | "CUSTOMER"
      order_status:
        | "draft"
        | "pending_confirmation"
        | "confirmed"
        | "preparing"
        | "ready"
        | "completed"
        | "rejected"
        | "cancelled"
      payment_kind: "payment" | "refund"
      payment_method: "cash" | "upi" | "card" | "bank_transfer" | "other"
      prep_type: "made_to_order" | "ready_stock"
      staff_role: "admin" | "counter" | "chef"
      ticket_line_status: "pending" | "preparing" | "ready" | "cancelled"
      ticket_status: "new" | "acknowledged" | "preparing" | "ready" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof (PublicSchema["Tables"] & PublicSchema["Views"])> =
  (PublicSchema["Tables"] & PublicSchema["Views"])[T] extends { Row: infer R } ? R : never

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]

export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T]

export const Constants = {
  public: {
    Enums: {
      fulfilment_type: ["collect", "setup"],
      order_source: ["IN_STORE", "ONLINE", "CALL", "CUSTOMER"],
      order_status: [
        "draft",
        "pending_confirmation",
        "confirmed",
        "preparing",
        "ready",
        "completed",
        "rejected",
        "cancelled",
      ],
      payment_kind: ["payment", "refund"],
      payment_method: ["cash", "upi", "card", "bank_transfer", "other"],
      prep_type: ["made_to_order", "ready_stock"],
      staff_role: ["admin", "counter", "chef"],
      ticket_line_status: ["pending", "preparing", "ready", "cancelled"],
      ticket_status: ["new", "acknowledged", "preparing", "ready", "cancelled"],
    },
  },
} as const
