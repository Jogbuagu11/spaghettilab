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
  delivery_photo_url: string | null;
  delivery_note: string | null;
  completed_at: string | null;
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
  /** Object path inside the delivery-proof bucket, from uploadDeliveryPhoto. */
  photoPath?: string | undefined;
  deliveryNote?: string | undefined;
}): Promise<{ ok: true; status: string; refunded: boolean; photoUrl: string | null }> {
  return callFunction("update-order-status", { method: "POST", body: JSON.stringify(input) });
}

const PHOTO_MAX_EDGE = 1600;
const PHOTO_QUALITY = 0.72;

/**
 * Shrinks a camera photo before upload. A modern phone shoots 4-12MB, which is
 * slow on a kitchen's mobile connection and far larger than an email needs.
 * Falls back to the original file if canvas encoding isn't available.
 */
async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Uploads proof of delivery and returns its object path.
 *
 * The filename is random so the public URL can't be guessed from the order id
 * alone — the bucket is public because email clients can't authenticate, so
 * the path is what keeps a customer's doorstep photo private.
 */
export async function uploadDeliveryPhoto(orderId: string, file: File): Promise<string> {
  const body = await compress(file);
  const suffix = crypto.randomUUID().replace(/-/g, "");
  const path = `${orderId}/${suffix}.jpg`;

  const { error } = await supabase.storage
    .from("delivery-proof")
    .upload(path, body, { contentType: "image/jpeg", upsert: false });

  if (error) throw new ApiError(error.message, 400);
  return path;
}

// --------------------------------------------------- weekly standing order ----

export interface CreateSubscriptionInput {
  sourceId: string;
  plates: Plate[];
  extras: Partial<Record<ExtraId, number>>;
  fulfillment: Fulfillment;
  /** 0 = Sunday. */
  dayOfWeek: number;
  /** Minute of the day the food should be ready. */
  readyMinute: number;
  deliveryAddress?: string | undefined;
  tipPercent?: number | undefined;
  customer: { name: string; email: string; phone: string };
}

export interface CreatedSubscription {
  reference: string;
  manageToken: string;
  nextRunDate: string;
  cardBrand: string | null;
  cardLast4: string | null;
}

export function createSubscription(input: CreateSubscriptionInput): Promise<CreatedSubscription> {
  return callFunction<CreatedSubscription>("create-subscription", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      plates: input.plates.map((p) => ({
        size: p.size,
        heat: p.heat,
        proteins: p.proteins,
        customizations: p.customs,
      })),
    }),
  });
}

export interface SubscriptionSummary {
  id: string;
  reference: string;
  status: "active" | "paused" | "payment_failed" | "cancelled";
  customer_name: string;
  fulfillment: Fulfillment;
  delivery_address: string | null;
  day_of_week: number;
  ready_minute: number;
  tip_percent: number;
  card_brand: string | null;
  card_last4: string | null;
  next_run_date: string;
  last_charged_at: string | null;
  created_at: string;
}

export interface SubscriptionResponse {
  subscription: SubscriptionSummary;
  skippedDates: string[];
}

export function getSubscription(token: string): Promise<SubscriptionResponse> {
  return callFunction<SubscriptionResponse>(
    `manage-subscription?token=${encodeURIComponent(token)}`,
  );
}

export type SubscriptionAction = "skip_next" | "pause" | "resume" | "cancel";

export function manageSubscription(
  token: string,
  action: SubscriptionAction,
): Promise<{ ok: true; status: string; nextRunDate?: string }> {
  return callFunction("manage-subscription", {
    method: "POST",
    body: JSON.stringify({ token, action }),
  });
}
