/**
 * Square Web Payments SDK loader and tokenizer.
 *
 * The card form is an iframe Square hosts, so raw card numbers never touch our
 * code or our servers — we only ever hold a single-use token, which the
 * create-order edge function charges.
 */

export const SQUARE_APP_ID = import.meta.env["VITE_SQUARE_APP_ID"] as string | undefined;
export const SQUARE_LOCATION_ID = import.meta.env["VITE_SQUARE_LOCATION_ID"] as string | undefined;
const SQUARE_ENV = (import.meta.env["VITE_SQUARE_ENVIRONMENT"] as string | undefined) ?? "sandbox";

export const isSquareConfigured = Boolean(SQUARE_APP_ID && SQUARE_LOCATION_ID);

const SDK_URL =
  SQUARE_ENV === "production"
    ? "https://web.squarecdn.com/v1/square.js"
    : "https://sandbox.web.squarecdn.com/v1/square.js";

/**
 * Square ships no types for the browser SDK, so these cover just the surface
 * we touch rather than pulling in an untyped `any`.
 */
export interface SquareTokenResult {
  status: string;
  token?: string;
  errors?: { message?: string }[];
}

export interface SquarePaymentMethod {
  attach(target: HTMLElement | string): Promise<void>;
  tokenize(): Promise<SquareTokenResult>;
  destroy?(): Promise<void>;
}

export interface SquarePaymentRequest {
  [key: string]: unknown;
}

export interface SquarePayments {
  card(options?: Record<string, unknown>): Promise<SquarePaymentMethod>;
  applePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  googlePay(request: SquarePaymentRequest): Promise<SquarePaymentMethod>;
  paymentRequest(options: Record<string, unknown>): SquarePaymentRequest;
  verifyBuyer(token: string, details: Record<string, unknown>): Promise<string>;
}

type SquareGlobal = { payments: (appId: string, locationId: string) => SquarePayments };

declare global {
  interface Window {
    Square?: SquareGlobal;
  }
}

let sdkPromise: Promise<SquareGlobal> | null = null;

/** Injects the SDK once, no matter how many components ask for it. */
export function loadSquareSdk(): Promise<SquareGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("Square SDK needs a browser"));
  if (window.Square) return Promise.resolve(window.Square);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<SquareGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    const script = existing ?? document.createElement("script");

    const onLoad = () => {
      if (window.Square) resolve(window.Square);
      else reject(new Error("Square SDK loaded but window.Square is missing"));
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", () => {
      sdkPromise = null;
      reject(new Error("Couldn't load Square. Check your connection and try again."));
    });

    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return sdkPromise;
}

export function createPayments(): Promise<SquarePayments> {
  if (!isSquareConfigured) {
    return Promise.reject(new Error("Square isn't configured for this site yet."));
  }
  return loadSquareSdk().then((sq) => sq.payments(SQUARE_APP_ID!, SQUARE_LOCATION_ID!));
}

/** Square wants decimal strings, not cents. */
export const toSquareAmount = (cents: number) => (cents / 100).toFixed(2);

export function buildPaymentRequest(
  payments: SquarePayments,
  totalCents: number,
  label = "Spaghetti Lab",
): SquarePaymentRequest {
  return payments.paymentRequest({
    countryCode: "US",
    currencyCode: "USD",
    total: { amount: toSquareAmount(totalCents), label },
  });
}

export interface TokenResult {
  token: string;
  /** Explicitly `| undefined`: the project runs exactOptionalPropertyTypes. */
  verificationToken?: string | undefined;
}

export interface BuyerDetails {
  name: string;
  email: string;
  postalCode?: string | undefined;
}

/**
 * Tokenizes, then runs 3-D Secure / SCA verification. Square requires the
 * resulting verification token for the payment to qualify for liability shift.
 */
export async function tokenize(
  payments: SquarePayments,
  method: SquarePaymentMethod,
  totalCents: number,
  buyer: BuyerDetails,
): Promise<TokenResult> {
  const result = await method.tokenize();

  if (result.status !== "OK" || !result.token) {
    const detail = result.errors?.[0]?.message;
    throw new Error(detail ?? "Please check your card details and try again.");
  }

  let verificationToken: string | undefined;
  try {
    const [givenName, ...rest] = buyer.name.trim().split(/\s+/);
    verificationToken = await payments.verifyBuyer(result.token, {
      amount: toSquareAmount(totalCents),
      currencyCode: "USD",
      intent: "CHARGE",
      billingContact: {
        givenName: givenName || buyer.name,
        familyName: rest.join(" ") || undefined,
        email: buyer.email,
        countryCode: "US",
        postalCode: buyer.postalCode,
      },
    });
  } catch (error) {
    // Verification is best-effort: a failure here shouldn't block a good card.
    console.warn("buyer verification skipped", error);
  }

  return { token: result.token, verificationToken };
}
