import { SITE_URL } from "../env.ts";
import { formatReadyAt } from "../schedule.ts";
import { BRAND, card, escapeHtml, label, money, paragraph, renderEmail } from "./layout.ts";

const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export interface EmailOrderItem {
  label: string;
  quantity: number;
  total_price_cents: number;
  config: Record<string, unknown>;
}

export interface EmailOrder {
  order_number: string;
  customer_email?: string;
  fulfillment: "pickup" | "delivery";
  customer_name: string;
  delivery_address: string | null;
  ready_at: string | null;
  scheduled_for: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number;
  square_receipt_url: string | null;
  card_brand: string | null;
  card_last4: string | null;
  track_token: string;
  customer_note: string | null;
  items: EmailOrderItem[];
}

export interface EmailContext {
  pickupAddress: string | null;
  contactPhone: string | null;
  googleReviewUrl: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

const firstName = (full: string) => escapeHtml(full.trim().split(/\s+/)[0] || "there");
const trackUrl = (order: EmailOrder) => `${SITE_URL}/track?token=${order.track_token}`;

/** Line items plus the totals block, shared by every order-related email. */
function receipt(order: EmailOrder): string {
  const rows = order.items
    .map((item) => {
      const summary = typeof item.config?.summary === "string" ? item.config.summary : "";
      return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-family:${SANS};font-size:15px;color:${BRAND.ink};">
          <strong>${item.quantity > 1 ? `${item.quantity}× ` : ""}${escapeHtml(item.label)}</strong>
          ${summary ? `<br><span style="font-size:13px;color:${BRAND.mutedText};">${escapeHtml(summary)}</span>` : ""}
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${BRAND.border};font-family:${SANS};font-size:15px;color:${BRAND.ink};white-space:nowrap;vertical-align:top;">
          ${money(item.total_price_cents)}
        </td>
      </tr>`;
    })
    .join("");

  const totalRow = (name: string, cents: number, bold = false) => `
      <tr>
        <td style="padding:5px 0;font-family:${SANS};font-size:${bold ? "17px" : "14px"};${bold ? "font-weight:bold;" : ""}color:${bold ? BRAND.ink : BRAND.mutedText};">${escapeHtml(name)}</td>
        <td align="right" style="padding:5px 0;font-family:${SANS};font-size:${bold ? "17px" : "14px"};${bold ? "font-weight:bold;" : ""}color:${bold ? BRAND.ink : BRAND.mutedText};">${money(cents)}</td>
      </tr>`;

  return card(`
    ${label("Your order")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
      ${totalRow("Subtotal", order.subtotal_cents)}
      ${order.delivery_fee_cents > 0 ? totalRow("Delivery", order.delivery_fee_cents) : ""}
      ${totalRow("Tax", order.tax_cents)}
      ${order.tip_cents > 0 ? totalRow("Tip", order.tip_cents) : ""}
      <tr><td colspan="2" style="padding-top:8px;border-top:2px solid ${BRAND.ink};"></td></tr>
      ${totalRow("Total", order.total_cents, true)}
    </table>`);
}

/** Where and when to collect the food. */
function fulfillmentBlock(order: EmailOrder, ctx: EmailContext): string {
  const readyLine = order.ready_at
    ? formatReadyAt(new Date(order.ready_at))
    : "We'll confirm shortly";
  const heading = order.fulfillment === "pickup" ? "Pickup" : "Delivery";
  const where =
    order.fulfillment === "pickup"
      ? ctx.pickupAddress
        ? escapeHtml(ctx.pickupAddress)
        : "We'll text you the pickup address shortly."
      : escapeHtml(order.delivery_address ?? "");

  return card(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="50%" style="vertical-align:top;padding-right:10px;">
          ${label(order.scheduled_for ? "Scheduled for" : "Ready by")}
          <p style="margin:0;font-family:${SANS};font-size:17px;font-weight:bold;color:${BRAND.ink};">${escapeHtml(readyLine)}</p>
        </td>
        <td width="50%" style="vertical-align:top;padding-left:10px;border-left:1px solid ${BRAND.border};">
          ${label(heading)}
          <p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.5;color:${BRAND.ink};">${where}</p>
        </td>
      </tr>
    </table>
    ${order.customer_note ? `<p style="margin:16px 0 0;padding-top:14px;border-top:1px solid ${BRAND.border};font-family:${SANS};font-size:14px;color:${BRAND.mutedText};"><strong style="color:${BRAND.ink};">Your note:</strong> ${escapeHtml(order.customer_note)}</p>` : ""}`);
}

function paymentFooter(order: EmailOrder): string {
  const cardLine =
    order.card_brand && order.card_last4
      ? `Paid with ${escapeHtml(order.card_brand)} ending ${escapeHtml(order.card_last4)}.`
      : "Payment received.";
  const receiptLink = order.square_receipt_url
    ? ` <a href="${order.square_receipt_url}" style="color:${BRAND.mutedText};">View Square receipt</a>.`
    : "";
  return `${cardLine}${receiptLink}`;
}

// --------------------------------------------------------------- customer ----

export function orderConfirmation(order: EmailOrder, ctx: EmailContext): RenderedEmail {
  return {
    subject: `Order ${order.order_number} confirmed — Spaghetti Lab`,
    html: renderEmail({
      preheader: `We've got your order. ${order.fulfillment === "pickup" ? "Pickup" : "Delivery"} details inside.`,
      eyebrow: `Order ${order.order_number}`,
      heading: `Thanks, ${firstName(order.customer_name)} — we're on it.`,
      body: `
        ${paragraph("Your order is paid and heading into the kitchen. Here's everything in one place.")}
        ${fulfillmentBlock(order, ctx)}
        ${receipt(order)}`,
      cta: { label: "Track your order", url: trackUrl(order) },
      footerNote: paymentFooter(order),
    }),
  };
}

const STATUS_COPY: Record<
  string,
  { eyebrow: string; heading: (n: string) => string; body: string; preheader: string }
> = {
  preparing: {
    eyebrow: "In the kitchen",
    heading: (n) => `${n}, your spaghetti is cooking.`,
    body: "We've started on your order. We'll let you know the moment it's ready.",
    preheader: "Your order is being prepared.",
  },
  ready: {
    eyebrow: "Ready now",
    heading: (n) => `${n}, your order is ready!`,
    body: "Come grab it while it's hot. Bring your order number — that's all you need.",
    preheader: "Your order is ready for pickup.",
  },
  out_for_delivery: {
    eyebrow: "On the way",
    heading: (n) => `${n}, your order is out for delivery.`,
    body: "Your food just left the kitchen. Keep an eye out for us in the next few minutes.",
    preheader: "Your order is on its way.",
  },
  completed: {
    eyebrow: "Enjoy",
    heading: (n) => `Buon appetito, ${n}!`,
    body: "Your order is complete. Thanks for eating with us — we hope it hit the spot.",
    preheader: "Thanks for your order.",
  },
};

export function orderStatus(
  order: EmailOrder,
  ctx: EmailContext,
  status: string,
): RenderedEmail | null {
  const copy = STATUS_COPY[status];
  if (!copy) return null;

  const showWhere = status === "ready" && order.fulfillment === "pickup";
  const subjectByStatus: Record<string, string> = {
    preparing: `We're cooking order ${order.order_number}`,
    ready: `Order ${order.order_number} is ready for pickup`,
    out_for_delivery: `Order ${order.order_number} is on the way`,
    completed: `Thanks for your order, ${firstName(order.customer_name)}`,
  };

  return {
    subject: `${subjectByStatus[status]} — Spaghetti Lab`,
    html: renderEmail({
      preheader: copy.preheader,
      eyebrow: `Order ${order.order_number}`,
      heading: copy.heading(firstName(order.customer_name)),
      body: `
        ${paragraph(copy.body)}
        ${showWhere && ctx.pickupAddress ? card(`${label("Pickup address")}<p style="margin:0;font-family:${SANS};font-size:17px;font-weight:bold;color:${BRAND.ink};">${escapeHtml(ctx.pickupAddress)}</p>${ctx.contactPhone ? `<p style="margin:8px 0 0;font-family:${SANS};font-size:14px;color:${BRAND.mutedText};">Questions? Call ${escapeHtml(ctx.contactPhone)}</p>` : ""}`) : ""}`,
      cta:
        status === "completed"
          ? { label: "Order again", url: `${SITE_URL}/menu` }
          : { label: "Track your order", url: trackUrl(order) },
    }),
  };
}

export function orderCancelled(
  order: EmailOrder,
  reason: string | null,
  refunded: boolean,
): RenderedEmail {
  return {
    subject: `Order ${order.order_number} was cancelled — Spaghetti Lab`,
    html: renderEmail({
      preheader: refunded
        ? "Your order was cancelled and refunded in full."
        : "Your order was cancelled.",
      eyebrow: `Order ${order.order_number}`,
      heading: "We had to cancel your order.",
      body: `
        ${paragraph(`Sorry, ${firstName(order.customer_name)} — we couldn't complete this one.`)}
        ${reason ? card(`${label("Reason")}<p style="margin:0;font-family:${SANS};font-size:15px;color:${BRAND.ink};">${escapeHtml(reason)}</p>`) : ""}
        ${paragraph(
          refunded
            ? `We've refunded <strong>${money(order.total_cents)}</strong> to your card. Depending on your bank it can take 5–10 business days to appear.`
            : "No charge was taken for this order.",
        )}`,
      cta: { label: "Start a new order", url: `${SITE_URL}/menu` },
    }),
  };
}

export function reviewRequest(order: EmailOrder, ctx: EmailContext): RenderedEmail {
  return {
    subject: `How was your spaghetti, ${firstName(order.customer_name)}?`,
    html: renderEmail({
      preheader: "Thirty seconds of your time would really help a small kitchen.",
      eyebrow: "One quick favour",
      heading: "How did we do?",
      body: `
        ${paragraph(`Thanks for ordering with us, ${firstName(order.customer_name)}. We're a small home kitchen, so a short review genuinely moves the needle for us.`)}
        ${paragraph("It takes about thirty seconds.")}`,
      cta: { label: "Leave a review", url: `${SITE_URL}/review?token=${order.track_token}` },
      footerNote: ctx.googleReviewUrl
        ? `Prefer Google? <a href="${ctx.googleReviewUrl}" style="color:${BRAND.mutedText};">Review us there instead</a>.`
        : undefined,
    }),
  };
}

// ------------------------------------------------------------------ admin ----

/** Internal new-order alert for the kitchen. */
export function kitchenAlert(order: EmailOrder, ctx: EmailContext): RenderedEmail {
  const when = order.ready_at ? formatReadyAt(new Date(order.ready_at)) : "ASAP";
  return {
    subject: `🍝 New order ${order.order_number} · ${money(order.total_cents)} · ${order.fulfillment}`,
    html: renderEmail({
      preheader: `${order.fulfillment} · ${when} · ${money(order.total_cents)}`,
      eyebrow: "New order",
      heading: `${order.order_number} — ${order.fulfillment === "pickup" ? "Pickup" : "Delivery"}`,
      body: `
        ${fulfillmentBlock(order, ctx)}
        ${receipt(order)}
        ${card(`${label("Customer")}<p style="margin:0;font-family:${SANS};font-size:15px;line-height:1.6;color:${BRAND.ink};">${escapeHtml(order.customer_name)}<br>${escapeHtml(order.delivery_address ? "Delivery" : "Pickup")}</p>`)}`,
      cta: { label: "Open admin dashboard", url: `${SITE_URL}/admin` },
    }),
  };
}

// ----------------------------------------------------- weekly standing ----

export interface EmailSubscription {
  reference: string;
  customer_name: string;
  fulfillment: "pickup" | "delivery";
  delivery_address: string | null;
  day_of_week: number;
  ready_minute: number;
  card_brand: string | null;
  card_last4: string | null;
  manage_token: string;
  next_run_date: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const clockTime = (minute: number) => {
  const h = Math.floor(minute / 60);
  return `${((h + 11) % 12) + 1}:${String(minute % 60).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

const manageUrl = (sub: EmailSubscription) => `${SITE_URL}/subscription?token=${sub.manage_token}`;

const scheduleLine = (sub: EmailSubscription) =>
  `Every ${DAY_NAMES[sub.day_of_week]} at ${clockTime(sub.ready_minute)}`;

/** Shown in every subscription email so cancelling is never more than one click. */
function standingOrderCard(sub: EmailSubscription): string {
  const where =
    sub.fulfillment === "pickup" ? "Pickup" : escapeHtml(sub.delivery_address ?? "Delivery");
  const cardLine =
    sub.card_brand && sub.card_last4
      ? `${escapeHtml(sub.card_brand)} ending ${escapeHtml(sub.card_last4)}`
      : "Card on file";

  return card(`
    ${label("Your standing order")}
    <p style="margin:0 0 10px;font-family:${SANS};font-size:17px;font-weight:bold;color:${BRAND.ink};">${escapeHtml(scheduleLine(sub))}</p>
    <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;color:${BRAND.mutedText};">
      ${where}<br>
      Paid automatically with ${cardLine}<br>
      Reference ${escapeHtml(sub.reference)}
    </p>`);
}

export function subscriptionConfirmed(sub: EmailSubscription): RenderedEmail {
  return {
    subject: `Your weekly spaghetti is set — ${sub.reference}`,
    html: renderEmail({
      preheader: `${scheduleLine(sub)}. Free delivery, every week.`,
      eyebrow: "Standing order confirmed",
      heading: `You're all set, ${firstName(sub.customer_name)}.`,
      body: `
        ${paragraph("Same plate, same time, every week — and delivery is on us, whatever the size.")}
        ${standingOrderCard(sub)}
        ${paragraph(`We'll charge your card and email a receipt the morning of each order, starting <strong>${escapeHtml(sub.next_run_date)}</strong>. You can skip a week, pause, or cancel any time — no notice needed.`)}`,
      cta: { label: "Manage your weekly order", url: manageUrl(sub) },
      footerNote: "Changes made before 9am on your delivery day apply to that week.",
    }),
  };
}

export function subscriptionPaymentFailed(
  sub: EmailSubscription,
  attemptsLeft: number,
): RenderedEmail {
  return {
    subject: `We couldn't charge your card — ${sub.reference}`,
    html: renderEmail({
      preheader: "Your weekly order didn't go through this week.",
      eyebrow: "Payment problem",
      heading: "We couldn't take this week's payment.",
      body: `
        ${paragraph(`Hi ${firstName(sub.customer_name)} — your card was declined, so this week's order hasn't been placed.`)}
        ${standingOrderCard(sub)}
        ${paragraph(
          attemptsLeft > 0
            ? `We'll try again next week. Update your card to get back on track.`
            : `We've paused your standing order for now. Update your card to restart it whenever you're ready.`,
        )}`,
      cta: { label: "Update your card", url: manageUrl(sub) },
    }),
  };
}

export function subscriptionCancelled(sub: EmailSubscription): RenderedEmail {
  return {
    subject: `Your weekly order is cancelled — ${sub.reference}`,
    html: renderEmail({
      preheader: "No further charges. Your card has been removed.",
      eyebrow: "Standing order cancelled",
      heading: "That's all stopped.",
      body: `
        ${paragraph(`Thanks for eating with us, ${firstName(sub.customer_name)}. Your weekly order is cancelled, your card has been removed, and you won't be charged again.`)}
        ${paragraph("If you change your mind, starting a new one takes about a minute.")}`,
      cta: { label: "Start a new weekly order", url: `${SITE_URL}/menu` },
    }),
  };
}
