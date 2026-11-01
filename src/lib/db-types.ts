/**
 * Row shapes for the tables the admin dashboard reads directly through
 * PostgREST. Supabase can generate these (`supabase gen types typescript`),
 * but hand-writing the handful we use keeps the build free of a codegen step.
 */

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled"
  | "refunded";

export interface OrderItemRow {
  label: string;
  quantity: number;
  unit_price_cents?: number;
  total_price_cents: number;
  config: { summary?: string } & Record<string, unknown>;
  sort_order: number;
}

export interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  fulfillment: "pickup" | "delivery";
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string | null;
  scheduled_for: string | null;
  ready_at: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  customer_note: string | null;
  delivery_photo_url: string | null;
  delivery_note: string | null;
  completed_at: string | null;
  created_at: string;
  order_items: OrderItemRow[] | null;
}

export interface MenuOptionRow {
  id: string;
  group_name: "size" | "heat" | "protein" | "customization" | "extra";
  label: string;
  price_cents: number;
  sort_order: number;
  is_available: boolean;
}

export interface BusinessHourRow {
  day_of_week: number;
  is_closed: boolean;
  open_minute: number;
  close_minute: number;
}

/** Indexable because the settings form renders fields from a list of keys. */
export interface SettingsRow extends Record<string, unknown> {
  id: number;
  is_accepting_orders: boolean;
  closed_message: string | null;
}

export interface ReviewRow {
  id: string;
  rating: number;
  body: string | null;
  author_name: string;
  is_published: boolean;
  created_at: string;
  orders: { order_number: string } | null;
}
