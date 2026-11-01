// Prices in cents. Phase 2 moves these server-side (admin-editable) and re-validates at checkout.
export const SIZES = [
  { id: "small", label: "Small", price: 1200 },
  { id: "medium", label: "Medium", price: 1800 },
  { id: "large", label: "Large", price: 2600 },
] as const;
export type SizeId = (typeof SIZES)[number]["id"];

export const HEAT = [
  { id: "spicy", label: "Spicy" },
  { id: "mild", label: "Not Spicy" },
] as const;
export type HeatId = (typeof HEAT)[number]["id"];

export const PROTEINS = [
  { id: "meatball", label: "Meatball", price: 400 },
  { id: "sausage", label: "Sausage", price: 400 },
  { id: "minced-pork", label: "Minced Pork", price: 400 },
] as const;
export type ProteinId = (typeof PROTEINS)[number]["id"];

export const CUSTOMIZATIONS = [
  { id: "mushroom", label: "Mushroom", price: 100 },
  { id: "extra-cheese", label: "Extra Cheese", price: 100 },
] as const;
export type CustomId = (typeof CUSTOMIZATIONS)[number]["id"];

export const EXTRAS = [
  { id: "garlic-bread", label: "Garlic Bread (slice)", price: 200, kind: "side" },
  { id: "water", label: "Bottled Water", price: 200, kind: "drink" },
  { id: "coke", label: "Coke (can)", price: 200, kind: "drink" },
] as const;
export type ExtraId = (typeof EXTRAS)[number]["id"];

export const DELIVERY_FEE = 700;
export const FREE_DELIVERY_OVER = 6000;
export const DEFAULT_TAX_RATE = 0.09375; // Phase 2: admin-configurable
export const OPEN_HOUR = 12;
export const CLOSE_HOUR = 20;
export const PREP_MINUTES = 15;

export const formatMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Live menu
//
// The arrays above are the build-time defaults. At runtime the storefront
// overlays the `menu_options` and `settings` rows from Supabase (see
// `src/lib/storefront.ts`) so the admin can change a price or flag something
// sold out without a deploy. Checkout re-prices against those same rows
// server-side, so these values are only ever used for display.
// ---------------------------------------------------------------------------

export interface MenuItem {
  id: string;
  label: string;
  description?: string | null;
  price: number;
  available: boolean;
}

export interface MenuData {
  sizes: MenuItem[];
  heat: MenuItem[];
  proteins: MenuItem[];
  customizations: MenuItem[];
  extras: MenuItem[];
  taxRate: number;
  deliveryFee: number;
  freeDeliveryOver: number;
  /** Hours of notice needed for free delivery. 0 = spend threshold only. */
  freeDeliveryMinLeadHours: number;
  /** Weekly standing orders skip the delivery fee entirely. */
  subscriptionFreeDelivery: boolean;
  prepMinutes: number;
  acceptingOrders: boolean;
  closedMessage: string;
}

const toItems = (xs: ReadonlyArray<{ id: string; label: string; price?: number }>): MenuItem[] =>
  xs.map((x) => ({ id: x.id, label: x.label, price: x.price ?? 0, available: true }));

export const STATIC_MENU: MenuData = {
  sizes: toItems(SIZES),
  heat: toItems(HEAT),
  proteins: toItems(PROTEINS),
  customizations: toItems(CUSTOMIZATIONS),
  extras: toItems(EXTRAS),
  taxRate: DEFAULT_TAX_RATE,
  deliveryFee: DELIVERY_FEE,
  freeDeliveryOver: FREE_DELIVERY_OVER,
  freeDeliveryMinLeadHours: 12,
  subscriptionFreeDelivery: true,
  prepMinutes: PREP_MINUTES,
  acceptingOrders: true,
  closedMessage: "We're not taking orders right now — check back soon!",
};

export const findItem = (items: MenuItem[], id: string): MenuItem | undefined =>
  items.find((i) => i.id === id);
