import {
  STATIC_MENU,
  type CustomId,
  type ExtraId,
  type HeatId,
  type MenuData,
  type ProteinId,
  type SizeId,
} from "./menu";

export interface Plate {
  id: string;
  size: SizeId;
  heat: HeatId;
  proteins: Partial<Record<ProteinId, number>>;
  customs: CustomId[];
}

export type Fulfillment = "pickup" | "delivery";

// Every function takes the live menu, defaulting to the build-time one so
// callers that only need the standard prices (and the tests) stay unchanged.

export function platePrice(p: Plate, menu: MenuData = STATIC_MENU): number {
  const size = menu.sizes.find((s) => s.id === p.size)?.price ?? 0;
  const proteins = menu.proteins.reduce(
    (sum, pr) => sum + pr.price * (p.proteins[pr.id as ProteinId] ?? 0),
    0,
  );
  const customs = menu.customizations
    .filter((c) => p.customs.includes(c.id as CustomId))
    .reduce((sum, c) => sum + c.price, 0);
  return size + proteins + customs;
}

export function extrasPrice(
  extras: Partial<Record<ExtraId, number>>,
  menu: MenuData = STATIC_MENU,
): number {
  return menu.extras.reduce((sum, e) => sum + e.price * (extras[e.id as ExtraId] ?? 0), 0);
}

export function deliveryFee(
  subtotal: number,
  fulfillment: Fulfillment,
  menu: MenuData = STATIC_MENU,
): number {
  if (fulfillment === "pickup") return 0;
  return subtotal > menu.freeDeliveryOver ? 0 : menu.deliveryFee;
}

export function orderTotals(
  plates: Plate[],
  extras: Partial<Record<ExtraId, number>>,
  fulfillment: Fulfillment,
  taxRate: number,
  menu: MenuData = STATIC_MENU,
) {
  const subtotal = plates.reduce((s, p) => s + platePrice(p, menu), 0) + extrasPrice(extras, menu);
  const delivery = deliveryFee(subtotal, fulfillment, menu);
  const tax = Math.round(subtotal * taxRate);
  const untilFree =
    fulfillment === "delivery" && delivery > 0 ? menu.freeDeliveryOver - subtotal + 1 : 0;
  return { subtotal, delivery, tax, total: subtotal + delivery + tax, untilFree };
}
