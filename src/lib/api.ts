import { functionsBaseUrl, isSupabaseConfigured, supabase } from "./supabase";
import type { ExtraId } from "./menu";
import type { Fulfillment, Plate } from "./pricing";

/** Thrown with the human-readable message an edge function returned. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function callFunction<T>(name: string, init: RequestInit = {}): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new ApiError("Ordering isn't available right now. Please try again shortly.", 503);
  }

  const anonKey = import.meta.env["VITE_SUPABASE_ANON_KEY"] as string;
  const { data } = await supabase.auth.getSession();

  const res = await fetch(`${functionsBaseUrl}/${name}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      // Admin calls need the user's JWT; public ones fall back to the anon key.
      authorization: `Bearer ${data.session?.access_token ?? anonKey}`,
      apikey: anonKey,
      ...(init.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error ?? "Something went wrong. Please try again.", res.status);
  }
  return body as T;
}

// ------------------------------------------------------------- checkout ----

export interface PlacedOrder {
  orderNumber: string;
  trackToken: string;
  status: string;
  receiptUrl: string | null;
  totalCents: number;
}

export interface PlaceOrderInput {
  sourceId: string;
  verificationToken?: string | undefined;
  plates: Plate[];
  extras: Partial<Record<ExtraId, number>>;
  fulfillment: Fulfillment;
  /** "asap" or an ISO timestamp from the slot picker. */
  when: string;
  deliveryAddress?: string | undefined;
  tipCents?: number | undefined;
  note?: string | undefined;
  customer: { name: string; email: string; phone: string };
}

export function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  return callFunction<PlacedOrder>("create-order", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      // The server re-prices from the database; it only needs the selections.
      plates: input.plates.map((p) => ({
        size: p.size,
        heat: p.heat,
        proteins: p.proteins,
        customizations: p.customs,
      })),
    }),
  });
}

// ---------------------------------------------------------------- track ----

export interface TrackedOrderItem {
  label: string;
  quantity: number;
  total_price_cents: number;
  config: { summary?: string };
}

export interface TrackedOrder {
  order_number: string;
  status: string;
  fulfillment: Fulfillment;
  customer_name: string;
  delivery_address: string | null;
  scheduled_for: string | null;
  ready_at: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  square_receipt_url: string | null;
  card_brand: string | null;
  card_last4: string | null;
  customer_note: string | null;
  created_at: string;
  items: TrackedOrderItem[];
}

export interface TrackResponse {
  order: TrackedOrder;
  pickupAddress: string | null;
  contactPhone: string | null;
  reviewUrl: string | null;
}

export function trackOrder(token: string): Promise<TrackResponse> {
  return callFunction<TrackResponse>(`track-order?token=${encodeURIComponent(token)}`);
}

// --------------------------------------------------------------- review ----

export function submitReview(token: string, rating: number, body: string): Promise<{ ok: true }> {
  return callFunction("submit-review", {
    method: "POST",
    body: JSON.stringify({ token, rating, body }),
  });
}

// ---------------------------------------------------------------- admin ----

export function updateOrderStatus(input: {
  orderId: string;
  status: string;
  reason?: string | undefined;
  refund?: boolean | undefined;
}): Promise<{ ok: true; status: string; refunded: boolean }> {
  return callFunction("update-order-status", { method: "POST", body: JSON.stringify(input) });
}
