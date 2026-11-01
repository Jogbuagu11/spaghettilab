import { requireEnv, squareApiBase } from "./env.ts";
import { PublicError } from "./http.ts";

// Pin the API version so Square can evolve without breaking us mid-service.
const SQUARE_VERSION = "2025-09-24";

async function squareFetch(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${squareApiBase()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requireEnv("SQUARE_ACCESS_TOKEN")}`,
      "square-version": SQUARE_VERSION,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.errors?.[0];
    console.error("square error", res.status, JSON.stringify(body?.errors ?? body));
    throw new PublicError(squareMessage(detail), res.status >= 500 ? 502 : 400);
  }
  return body;
}

/** Square's raw codes are developer-facing; map the common ones to plain English. */
function squareMessage(detail: { code?: string; detail?: string } | undefined): string {
  switch (detail?.code) {
    case "CARD_DECLINED":
    case "GENERIC_DECLINE":
      return "Your card was declined. Please try a different card.";
    case "CVV_FAILURE":
      return "The security code didn't match. Please check it and try again.";
    case "ADDRESS_VERIFICATION_FAILURE":
      return "The billing ZIP code didn't match your card.";
    case "EXPIRATION_FAILURE":
      return "That card's expiry date looks wrong.";
    case "INSUFFICIENT_FUNDS":
      return "That card has insufficient funds.";
    case "CARD_EXPIRED":
      return "That card has expired.";
    case "PAYMENT_LIMIT_EXCEEDED":
      return "That payment exceeds your card's limit.";
    default:
      return "We couldn't process that payment. Please try another card.";
  }
}

export interface ChargeInput {
  /** A single-use token, or a saved card id when charging a card on file. */
  sourceId: string;
  amountCents: number;
  idempotencyKey: string;
  referenceId: string;
  note: string;
  buyerEmail?: string;
  verificationToken?: string;
  /** Required by Square when sourceId is a stored card. */
  customerId?: string;
  /** Settle an itemised order created via createItemizedOrder. */
  orderId?: string;
  /** Recorded separately from the order total so Square reports tips as tips. */
  tipCents?: number;
}

/** The slice of Square's Payment object we read. */
export interface SquarePaymentResponse {
  id: string;
  status: string;
  order_id?: string;
  receipt_url?: string;
  card_details?: { card?: { card_brand?: string; last_4?: string } };
  refunded_money?: { amount?: number };
}

export interface ChargeResult {
  paymentId: string;
  orderId?: string;
  receiptUrl?: string;
  cardBrand?: string;
  last4?: string;
  status: string;
}

/**
 * Charges a Web Payments SDK token. `idempotencyKey` is the order id, so a
 * retried request can never double-charge.
 */
export async function createPayment(input: ChargeInput): Promise<ChargeResult> {
  const body = await squareFetch("/v2/payments", {
    method: "POST",
    body: JSON.stringify({
      source_id: input.sourceId,
      idempotency_key: input.idempotencyKey,
      amount_money: { amount: input.amountCents, currency: "USD" },
      ...(input.tipCents ? { tip_money: { amount: input.tipCents, currency: "USD" } } : {}),
      ...(input.orderId ? { order_id: input.orderId } : {}),
      location_id: requireEnv("SQUARE_LOCATION_ID"),
      reference_id: input.referenceId,
      note: input.note.slice(0, 500),
      buyer_email_address: input.buyerEmail,
      verification_token: input.verificationToken,
      customer_id: input.customerId,
      autocomplete: true,
    }),
  });

  const payment = body.payment as SquarePaymentResponse;
  return {
    paymentId: payment.id,
    orderId: payment.order_id,
    receiptUrl: payment.receipt_url,
    cardBrand: payment.card_details?.card?.card_brand,
    last4: payment.card_details?.card?.last_4,
    status: payment.status,
  };
}

export async function refundPayment(paymentId: string, amountCents: number, reason: string) {
  return await squareFetch("/v2/refunds", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `refund-${paymentId}`,
      payment_id: paymentId,
      amount_money: { amount: amountCents, currency: "USD" },
      reason: reason.slice(0, 192),
    }),
  });
}

export async function getPayment(paymentId: string): Promise<SquarePaymentResponse> {
  const body = await squareFetch(`/v2/payments/${paymentId}`);
  return body.payment as SquarePaymentResponse;
}

// ------------------------------------------------------- cards on file ----

export interface SavedCard {
  customerId: string;
  cardId: string;
  brand?: string;
  last4?: string;
}

export interface SaveCardInput {
  /** Single-use token from the Web Payments SDK. */
  sourceId: string;
  name: string;
  email: string;
  phone: string;
  /** Stable key so a retried signup reuses the same Square customer. */
  idempotencyKey: string;
  postalCode?: string;
}

/**
 * Creates a Square customer and vaults the card against it, so weekly runs can
 * charge without the customer present. We keep only the returned ids — the card
 * number never reaches us, which is what keeps this out of PCI scope.
 */
export async function saveCardOnFile(input: SaveCardInput): Promise<SavedCard> {
  const [givenName, ...rest] = input.name.trim().split(/\s+/);

  const customerBody = await squareFetch("/v2/customers", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `cust-${input.idempotencyKey}`,
      given_name: givenName || input.name,
      family_name: rest.join(" ") || undefined,
      email_address: input.email,
      phone_number: input.phone,
      note: "Spaghetti Lab weekly standing order",
    }),
  });

  const customerId = (customerBody.customer as { id: string }).id;

  const cardBody = await squareFetch("/v2/cards", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `card-${input.idempotencyKey}`,
      source_id: input.sourceId,
      card: {
        customer_id: customerId,
        cardholder_name: input.name,
        billing_address: input.postalCode
          ? { postal_code: input.postalCode, country: "US" }
          : undefined,
      },
    }),
  });

  const card = cardBody.card as { id: string; card_brand?: string; last_4?: string };
  return { customerId, cardId: card.id, brand: card.card_brand, last4: card.last_4 };
}

/** Called when a subscription is cancelled, so we stop holding the card. */
export async function forgetCard(cardId: string): Promise<void> {
  try {
    await squareFetch(`/v2/cards/${cardId}/disable`, { method: "POST" });
  } catch (error) {
    // A card that's already gone shouldn't block a cancellation.
    console.warn("could not disable card", cardId, error);
  }
}

// ------------------------------------------------------ itemised orders ----

export interface ItemisedLine {
  name: string;
  variationName?: string;
  quantity: number;
  basePriceCents: number;
  modifiers: { name: string; priceCents: number; quantity: number }[];
}

export interface ItemisedOrder {
  orderId: string;
  /** Square's own total, which the payment must match to the cent. */
  totalCents: number;
  taxCents: number;
}

/**
 * Creates an itemised Square order so receipts, the Square dashboard and
 * item-level sales reporting all show real line items instead of one lump sum.
 *
 * Prices are sent explicitly rather than by catalog id: the admin can change a
 * price in Supabase without re-running the catalog sync, and a divergence there
 * would otherwise make Square compute a different total and reject the payment.
 *
 * Tax is left to Square to calculate so it is reported as tax rather than as a
 * fee. That only works because our rounding matches Square's half-to-even — see
 * roundCents in catalog.ts — and the caller still verifies the totals agree.
 */
export async function createItemizedOrder(input: {
  referenceId: string;
  idempotencyKey: string;
  lines: ItemisedLine[];
  deliveryFeeCents: number;
  taxRate: number;
}): Promise<ItemisedOrder> {
  const body = await squareFetch("/v2/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: input.idempotencyKey,
      order: {
        location_id: requireEnv("SQUARE_LOCATION_ID"),
        reference_id: input.referenceId,
        line_items: input.lines.map((line) => ({
          name: line.name,
          ...(line.variationName ? { variation_name: line.variationName } : {}),
          quantity: String(line.quantity),
          base_price_money: { amount: line.basePriceCents, currency: "USD" },
          ...(line.modifiers.length
            ? {
                modifiers: line.modifiers.map((m) => ({
                  name: m.name,
                  base_price_money: { amount: m.priceCents, currency: "USD" },
                  ...(m.quantity > 1 ? { quantity: String(m.quantity) } : {}),
                })),
              }
            : {}),
        })),
        // TOTAL_PHASE + taxable:false keeps delivery outside the tax base,
        // matching how we price it (California treats a separately stated
        // delivery charge as non-taxable).
        ...(input.deliveryFeeCents > 0
          ? {
              service_charges: [
                {
                  name: "Delivery",
                  amount_money: { amount: input.deliveryFeeCents, currency: "USD" },
                  calculation_phase: "TOTAL_PHASE",
                  taxable: false,
                },
              ],
            }
          : {}),
        taxes: [
          {
            name: "Sales tax",
            percentage: (input.taxRate * 100).toFixed(5).replace(/0+$/, "").replace(/\.$/, ""),
            scope: "ORDER",
            type: "ADDITIVE",
          },
        ],
      },
    }),
  });

  const order = body.order as {
    id: string;
    net_amounts: { total_money: { amount: number }; tax_money?: { amount: number } };
  };

  return {
    orderId: order.id,
    totalCents: order.net_amounts.total_money.amount,
    taxCents: order.net_amounts.tax_money?.amount ?? 0,
  };
}
