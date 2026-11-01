import { useQuery } from "@tanstack/react-query";
import { STATIC_MENU, type MenuData, type MenuItem } from "./menu";
import type { DayHours } from "./schedule";
import { isSupabaseConfigured, supabase } from "./supabase";

export interface StorefrontSettings {
  contactEmail: string;
  contactPhone: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  facebookUrl: string | null;
  googleReviewUrl: string | null;
  yelpUrl: string | null;
  ga4MeasurementId: string | null;
  metaPixelId: string | null;
  deliveryRadiusMiles: number;
  originPostalCode: string;
  slotIntervalMinutes: number;
}

export interface Storefront {
  menu: MenuData;
  hours: DayHours[];
  settings: StorefrontSettings;
  /** False while the live data is still loading, or if Supabase is unreachable. */
  isLive: boolean;
}

const DEFAULT_HOURS: DayHours[] = Array.from({ length: 7 }, (_, day_of_week) => ({
  day_of_week,
  is_closed: false,
  open_minute: 720,
  close_minute: 1200,
}));

const DEFAULT_SETTINGS: StorefrontSettings = {
  contactEmail: "hello@spaghettilab.store",
  contactPhone: null,
  instagramUrl: null,
  tiktokUrl: null,
  facebookUrl: null,
  googleReviewUrl: null,
  yelpUrl: null,
  ga4MeasurementId: null,
  metaPixelId: null,
  deliveryRadiusMiles: 5,
  originPostalCode: "95131",
  slotIntervalMinutes: 15,
};

export const FALLBACK_STOREFRONT: Storefront = {
  menu: STATIC_MENU,
  hours: DEFAULT_HOURS,
  settings: DEFAULT_SETTINGS,
  isLive: false,
};

interface OptionRow {
  id: string;
  group_name: MenuGroup;
  label: string;
  description: string | null;
  price_cents: number;
  sort_order: number;
  is_available: boolean;
}

type MenuGroup = "size" | "heat" | "protein" | "customization" | "extra";

/** The storefront-safe columns of `settings`; RLS withholds the rest. */
/**
 * Explicit column list, not `*`.
 *
 * `settings` is exposed to anon through a column-level grant that withholds
 * pickup_address, and a column-level grant makes `select *` fail outright if
 * *any* requested column isn't covered. Asking for exactly what we're allowed
 * to read keeps a newly added column from silently breaking the storefront.
 */
export const SETTINGS_COLUMNS = [
  "is_accepting_orders",
  "closed_message",
  "tax_rate",
  "delivery_fee_cents",
  "free_delivery_over_cents",
  "free_delivery_min_lead_hours",
  "subscription_free_delivery",
  "prep_minutes",
  "slot_interval_minutes",
  "delivery_radius_miles",
  "origin_postal_code",
  "contact_email",
  "contact_phone",
  "instagram_url",
  "tiktok_url",
  "facebook_url",
  "google_review_url",
  "yelp_url",
  "ga4_measurement_id",
  "meta_pixel_id",
].join(",");

interface SettingsRow {
  tax_rate: string | number;
  delivery_fee_cents: number;
  free_delivery_over_cents: number;
  free_delivery_min_lead_hours: number;
  subscription_free_delivery: boolean;
  prep_minutes: number;
  slot_interval_minutes: number;
  delivery_radius_miles: string | number;
  origin_postal_code: string;
  is_accepting_orders: boolean;
  closed_message: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  facebook_url: string | null;
  google_review_url: string | null;
  yelp_url: string | null;
  ga4_measurement_id: string | null;
  meta_pixel_id: string | null;
}

const toItem = (row: OptionRow): MenuItem => ({
  id: row.id,
  label: row.label,
  description: row.description,
  price: row.price_cents,
  available: row.is_available,
});

async function fetchStorefront(): Promise<Storefront> {
  const [options, settings, hours] = await Promise.all([
    supabase
      .from("menu_options")
      .select("id, group_name, label, description, price_cents, sort_order, is_available")
      .order("sort_order"),
    supabase.from("settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle(),
    supabase.from("business_hours").select("*").order("day_of_week"),
  ]);

  if (options.error) throw options.error;
  // A settings failure falls back to defaults rather than blanking the menu,
  // but it must not be silent — that's how the missing grant went unnoticed.
  if (settings.error) {
    console.error("[spaghetti-lab] settings unreadable, using defaults", settings.error);
  }

  const rows = (options.data ?? []) as OptionRow[];
  const group = (name: MenuGroup) => rows.filter((r) => r.group_name === name).map(toItem);
  const s = settings.data as SettingsRow | null;

  // A group the admin emptied would break the builder, so keep the defaults.
  const orDefault = (live: MenuItem[], fallback: MenuItem[]) => (live.length > 0 ? live : fallback);

  return {
    menu: {
      sizes: orDefault(group("size"), STATIC_MENU.sizes),
      heat: orDefault(group("heat"), STATIC_MENU.heat),
      proteins: orDefault(group("protein"), STATIC_MENU.proteins),
      customizations: orDefault(group("customization"), STATIC_MENU.customizations),
      extras: orDefault(group("extra"), STATIC_MENU.extras),
      taxRate: s ? Number(s.tax_rate) : STATIC_MENU.taxRate,
      deliveryFee: s ? s.delivery_fee_cents : STATIC_MENU.deliveryFee,
      freeDeliveryOver: s ? s.free_delivery_over_cents : STATIC_MENU.freeDeliveryOver,
      freeDeliveryMinLeadHours: s
        ? Number(s.free_delivery_min_lead_hours ?? 12)
        : STATIC_MENU.freeDeliveryMinLeadHours,
      subscriptionFreeDelivery: s
        ? (s.subscription_free_delivery ?? true)
        : STATIC_MENU.subscriptionFreeDelivery,
      prepMinutes: s ? s.prep_minutes : STATIC_MENU.prepMinutes,
      acceptingOrders: s ? s.is_accepting_orders : true,
      closedMessage: s?.closed_message ?? STATIC_MENU.closedMessage,
    },
    hours: (hours.data as DayHours[] | null)?.length ? (hours.data as DayHours[]) : DEFAULT_HOURS,
    settings: s
      ? {
          contactEmail: s.contact_email ?? DEFAULT_SETTINGS.contactEmail,
          contactPhone: s.contact_phone,
          instagramUrl: s.instagram_url,
          tiktokUrl: s.tiktok_url,
          facebookUrl: s.facebook_url,
          googleReviewUrl: s.google_review_url,
          yelpUrl: s.yelp_url,
          ga4MeasurementId: s.ga4_measurement_id,
          metaPixelId: s.meta_pixel_id,
          deliveryRadiusMiles: Number(s.delivery_radius_miles),
          originPostalCode: s.origin_postal_code,
          slotIntervalMinutes: s.slot_interval_minutes,
        }
      : DEFAULT_SETTINGS,
    isLive: true,
  };
}

/**
 * Live menu, hours and settings. Falls back to the build-time menu while
 * loading or if Supabase is unreachable, so the storefront always renders.
 */
export function useStorefront(): Storefront {
  const { data } = useQuery({
    queryKey: ["storefront"],
    queryFn: fetchStorefront,
    enabled: isSupabaseConfigured,
    staleTime: 60_000,
    retry: 1,
  });

  return data ?? FALLBACK_STOREFRONT;
}
