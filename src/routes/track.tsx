import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChefHat, CircleDashed, Clock, MapPin, Package, Truck } from "lucide-react";
import { useEffect } from "react";
import { PageShell } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { trackOrder, type TrackedOrder } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/menu";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/track")({
  // `new=true` arrives straight from checkout and triggers the cart reset.
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? (search["token"] as string) : "",
    new: search["new"] === true || search["new"] === "true",
  }),
  head: () => ({
    ...pageMeta(
      "Track your order | Spaghetti Lab",
      "Live status for your Spaghetti Lab order.",
      "/track",
    ),
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: TrackPage,
});

/** Delivery and pickup diverge at the last step. */
const pickupSteps = ["paid", "preparing", "ready", "completed"] as const;
const deliverySteps = ["paid", "preparing", "out_for_delivery", "completed"] as const;

const STEP_META: Record<string, { label: string; icon: typeof Clock; blurb: string }> = {
  paid: { label: "Order received", icon: CheckCircle2, blurb: "We've got your order and payment." },
  preparing: { label: "In the kitchen", icon: ChefHat, blurb: "Your spaghetti is being made." },
  ready: { label: "Ready for pickup", icon: Package, blurb: "Come grab it while it's hot." },
  out_for_delivery: { label: "Out for delivery", icon: Truck, blurb: "On the way to you now." },
  completed: { label: "Complete", icon: CheckCircle2, blurb: "Buon appetito!" },
};

function Progress({ order }: { order: TrackedOrder }) {
  const steps: readonly string[] = order.fulfillment === "delivery" ? deliverySteps : pickupSteps;
  const currentIndex = steps.indexOf(order.status);

  return (
    <ol className="space-y-1">
      {steps.map((step, index) => {
        const meta = STEP_META[step];
        if (!meta) return null;
        const done = currentIndex >= 0 && index <= currentIndex;
        const active = index === currentIndex;
        const Icon = done ? meta.icon : CircleDashed;

        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink ${
                  done ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              {index < steps.length - 1 && (
                <span className={`my-1 w-0.5 flex-1 ${done ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
            <div className="pb-5 pt-1.5">
              <p
                className={`font-bold ${active ? "text-primary" : done ? "" : "text-muted-foreground"}`}
              >
                {meta.label}
              </p>
              {active && <p className="text-sm text-muted-foreground">{meta.blurb}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TrackPage() {
  const { token, new: isNew } = Route.useSearch();
  const { clear } = useCart();

  const { data, isLoading, error } = useQuery({
    queryKey: ["track", token],
    queryFn: () => trackOrder(token),
    enabled: token.length > 0,
    // Poll while the order is live so the kitchen's updates show up on their own.
    refetchInterval: (query) => {
      const status = query.state.data?.order.status;
      return status && ["cancelled", "refunded", "completed"].includes(status) ? false : 30_000;
    },
  });

  // The order is placed and paid, so the cart has served its purpose.
  useEffect(() => {
    if (isNew && data?.order) clear();
  }, [isNew, data?.order, clear]);

  if (!token) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-3xl font-black">No order selected</h1>
          <p className="mt-3 text-muted-foreground">Open the tracking link we emailed you.</p>
          <Button asChild variant="lab" size="xl" className="mt-6">
            <Link to="/menu">Start an order</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center text-muted-foreground">
          Loading your order…
        </div>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-3xl font-black">We couldn't find that order</h1>
          <p className="mt-3 text-muted-foreground">
            The link may have expired or been mistyped. Check the email we sent you.
          </p>
          <Button asChild variant="labGhost" size="xl" className="mt-6">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  const { order, pickupAddress, contactPhone } = data;
  const cancelled = order.status === "cancelled" || order.status === "refunded";
  const readyAt = order.ready_at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(order.ready_at))
    : null;

  return (
    <PageShell>
      <div className="mx-auto max-w-2xl px-4 py-10">
        {isNew && (
          <div className="mb-6 rounded-xl border-2 border-ink bg-accent p-4 text-accent-foreground">
            <p className="font-display text-xl font-bold">Thanks — your order is in! 🍝</p>
            <p className="mt-1 text-sm">We've emailed your receipt and this tracking link.</p>
          </div>
        )}

        <p className="lab-label text-primary">Order {order.order_number}</p>
        <h1 className="mt-1 text-4xl font-black">
          {cancelled ? "Order cancelled" : `Hi ${order.customer_name.split(" ")[0]}!`}
        </h1>

        {cancelled ? (
          <p className="mt-3 text-muted-foreground">
            This order was {order.status}. If you were charged, a refund is on its way.
          </p>
        ) : (
          <>
            {readyAt && (
              <p className="mt-2 flex items-center gap-2 text-muted-foreground">
                <Clock className="size-4" aria-hidden />
                {order.scheduled_for ? "Scheduled for" : "Ready by"}{" "}
                <strong className="text-foreground">{readyAt}</strong>
              </p>
            )}

            <div className="lab-card mt-6 p-5">
              <Progress order={order} />
            </div>

            {(pickupAddress || order.delivery_address) && (
              <div className="lab-card mt-4 p-5">
                <p className="lab-label text-muted-foreground">
                  {order.fulfillment === "pickup" ? "Pickup address" : "Delivering to"}
                </p>
                <p className="mt-1 flex items-start gap-2 font-semibold">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {order.fulfillment === "pickup" ? pickupAddress : order.delivery_address}
                </p>
                {contactPhone && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Questions?{" "}
                    <a href={`tel:${contactPhone}`} className="underline">
                      {contactPhone}
                    </a>
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className="lab-card mt-4 p-5">
          <p className="lab-label text-muted-foreground">Your order</p>
          <div className="mt-3 space-y-2">
            {order.items.map((item, index) => (
              <div key={index} className="flex justify-between gap-3 text-sm">
                <span>
                  <strong>
                    {item.quantity > 1 ? `${item.quantity}× ` : ""}
                    {item.label}
                  </strong>
                  {item.config?.summary && (
                    <span className="block text-muted-foreground">{item.config.summary}</span>
                  )}
                </span>
                <span className="font-mono whitespace-nowrap">
                  {formatMoney(item.total_price_cents)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t-2 border-dashed border-border pt-3 font-mono text-sm">
            <Row k="Subtotal" v={formatMoney(order.subtotal_cents)} />
            {order.delivery_fee_cents > 0 && (
              <Row k="Delivery" v={formatMoney(order.delivery_fee_cents)} />
            )}
            <Row k="Tax" v={formatMoney(order.tax_cents)} />
            {order.tip_cents > 0 && <Row k="Tip" v={formatMoney(order.tip_cents)} />}
            <Row k="Total" v={formatMoney(order.total_cents)} bold />
          </div>
          {order.square_receipt_url && (
            <a
              href={order.square_receipt_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-muted-foreground underline"
            >
              View Square receipt
            </a>
          )}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="lab" size="xl">
            <Link to="/menu">Order again</Link>
          </Button>
          {order.status === "completed" && (
            <Button asChild variant="labGhost" size="xl">
              <Link to="/review" search={{ token }}>
                Leave a review
              </Link>
            </Button>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "text-base font-bold" : ""}`}>
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
