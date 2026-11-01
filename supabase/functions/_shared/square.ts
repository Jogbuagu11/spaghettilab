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
  sourceId: string;
  amountCents: number;
  idempotencyKey: string;
  referenceId: string;
  note: string;
  buyerEmail?: string;
  verificationToken?: string;
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
