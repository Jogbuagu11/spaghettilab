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

/** What's in the plate before any add-on. Single choice, no charge. */
export const BASES = [
  { id: "minced-pork", label: "Minced Pork" },
  { id: "no-meat", label: "No meat" },
] as const;
export type BaseId = (typeof BASES)[number]["id"];
export const DEFAULT_BASE: BaseId = "minced-pork";

export const PROTEINS = [
  { id: "meatball", label: "Meatball", price: 400 },
  { id: "sausage", label: "Sausage", price: 400 },
] as const;
export type ProteinId = (typeof PROTEINS)[number]["id"];

export const CUSTOMIZATIONS = [
  { id: "mushroom", label: "Mushroom", price: 100, appliesTo: ["plate", "sandwich"] },
  { id: "extra-cheese", label: "Extra Cheese", price: 100, kind: "cheese", appliesTo: ["plate"] },
  { id: "provolone", label: "Provolone", price: 100, appliesTo: ["sandwich"] },
] as const;
export type CustomId = (typeof CUSTOMIZATIONS)[number]["id"];

// --- sandwiches ---------------------------------------------------------
// A second product line, not a plate variant: the price lives on the size,
// and both fillings cost the same, so the filling is a free choice.

export const SANDWICH_SIZES = [
  { id: "sandwich-small", label: "Small", price: 1000 },
  { id: "sandwich-medium", label: "Medium", price: 1200 },
  { id: "sandwich-large", label: "Large", price: 1800 },
] as const;
export type SandwichSizeId = (typeof SANDWICH_SIZES)[number]["id"];

export const SANDWICH_FILLINGS = [
  { id: "sandwich-meatball", label: "Meatball" },
  { id: "sandwich-sausage", label: "Sausage" },
] as const;
export type SandwichFillingId = (typeof SANDWICH_FILLINGS)[number]["id"];

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
  /** Lowercase tags, e.g. ["wheat", "dairy"]. Empty when none apply. */
  allergens: string[];
  /** What the item actually is, where that matters for the upsell. */
  kind?: MenuItemKind;
  /** Add-ons only: which products offer it. Defaults to both. */
  appliesTo: ProductKind[];
}

/** The two things a customer can order as a main. */
export type ProductKind = "plate" | "sandwich";

/** What an option is, so checkout can tell a Coke from a slice of bread. */
export type MenuItemKind = "drink" | "side" | "cheese";

export interface MenuData {
  sizes: MenuItem[];
  /** Sandwich sizes — priced separately from plate sizes. */
  sandwichSizes: MenuItem[];
  /** Meatball or sausage, free: both sizes cost the same. */
  sandwichFillings: MenuItem[];
  heat: MenuItem[];
  /** Single-select, free: minced pork (the default) or nothing. */
  bases: MenuItem[];
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

const KINDS = ["drink", "side", "cheese"] as const;
const isKind = (v: unknown): v is MenuItemKind =>
  typeof v === "string" && (KINDS as readonly string[]).includes(v);

const toItems = (
  xs: ReadonlyArray<{
    id: string;
    label: string;
    price?: number;
    kind?: string;
    appliesTo?: readonly string[];
  }>,
): MenuItem[] =>
  xs.map((x) => ({
    id: x.id,
    label: x.label,
    price: x.price ?? 0,
    available: true,
    allergens: [],
    appliesTo: [...(x.appliesTo ?? ["plate", "sandwich"])] as ProductKind[],
    ...(isKind(x.kind) ? { kind: x.kind } : {}),
  }));

/** The add-ons offered on one product. */
export const addOnsFor = (menu: MenuData, product: ProductKind): MenuItem[] =>
  menu.customizations.filter((c) => c.appliesTo.includes(product));

export const STATIC_MENU: MenuData = {
  sizes: toItems(SIZES),
  sandwichSizes: toItems(SANDWICH_SIZES),
  sandwichFillings: toItems(SANDWICH_FILLINGS),
  heat: toItems(HEAT),
  bases: toItems(BASES),
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
