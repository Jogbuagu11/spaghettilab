import {
  CUSTOMIZATIONS,
  DELIVERY_FEE,
  EXTRAS,
  FREE_DELIVERY_OVER,
  PROTEINS,
  SIZES,
  type CustomId,
  type ExtraId,
  type HeatId,
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

export function platePrice(p: Plate): number {
  const size = SIZES.find((s) => s.id === p.size)!.price;
  const proteins = PROTEINS.reduce((sum, pr) => sum + pr.price * (p.proteins[pr.id] ?? 0), 0);
  const customs = CUSTOMIZATIONS.filter((c) => p.customs.includes(c.id)).reduce(
    (sum, c) => sum + c.price,
    0,
  );
  return size + proteins + customs;
}

export function extrasPrice(extras: Partial<Record<ExtraId, number>>): number {
  return EXTRAS.reduce((sum, e) => sum + e.price * (extras[e.id] ?? 0), 0);
}

export function deliveryFee(subtotal: number, fulfillment: Fulfillment): number {
  if (fulfillment === "pickup") return 0;
  return subtotal > FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
}

export function orderTotals(
  plates: Plate[],
  extras: Partial<Record<ExtraId, number>>,
  fulfillment: Fulfillment,
  taxRate: number,
) {
  const subtotal = plates.reduce((s, p) => s + platePrice(p), 0) + extrasPrice(extras);
  const delivery = deliveryFee(subtotal, fulfillment);
  const tax = Math.round(subtotal * taxRate);
  const untilFree =
    fulfillment === "delivery" && delivery > 0 ? FREE_DELIVERY_OVER - subtotal + 1 : 0;
  return { subtotal, delivery, tax, total: subtotal + delivery + tax, untilFree };
}
