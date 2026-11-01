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
