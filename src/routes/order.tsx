import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CartLines } from "@/components/site/CartDrawer";
import { PageShell } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, placeOrder } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { formatMoney } from "@/lib/menu";
import { orderTotals } from "@/lib/pricing";
import { canOrderAsapWithHours, slotsForHours } from "@/lib/schedule";
import { pageMeta } from "@/lib/seo";
import {
  buildPaymentRequest,
  createPayments,
  isSquareConfigured,
  tokenize,
  type SquarePaymentMethod,
  type SquarePayments,
} from "@/lib/square";
import { useStorefront } from "@/lib/storefront";

export const Route = createFileRoute("/order")({
  head: () => ({
    ...pageMeta(
      "Checkout — Pickup or Delivery | Spaghetti Lab",
      "Choose pickup in Berryessa or delivery within 5 miles of 95131, pick ASAP or a scheduled time, and pay securely with card, Apple Pay or Google Pay.",
      "/order",
    ),
    meta: [
      ...pageMeta("", "", "/order").meta,
      // Checkout should never be indexed or shared.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: OrderPage,
});

const TIP_PERCENTS = [0, 10, 15, 20] as const;

function OrderPage() {
  const navigate = useNavigate();
  const { plates, extras, fulfillment, setFulfillment } = useCart();
  const { menu, hours, settings } = useStorefront();

  // Rendered on the client only — the server has no "now".
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const slots = useMemo(
    () => (now ? slotsForHours(now, hours, menu.prepMinutes, settings.slotIntervalMinutes) : []),
    [now, hours, menu.prepMinutes, settings.slotIntervalMinutes],
  );
  const asapAvailable = now ? canOrderAsapWithHours(now, hours, menu.prepMinutes) : false;

  const [when, setWhen] = useState("");
  useEffect(() => {
    if (!when && now) setWhen(asapAvailable ? "asap" : (slots[0]?.iso ?? ""));
  }, [now, asapAvailable, slots, when]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [tipPercent, setTipPercent] = useState<number>(15);

  const totals = orderTotals(plates, extras, fulfillment, menu.taxRate, menu);
  const tipCents = Math.round(totals.subtotal * (tipPercent / 100));
  const grandTotal = totals.total + tipCents;

  // ------------------------------------------------------------ Square ----
  const cardRef = useRef<HTMLDivElement>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);
  const cardInstanceRef = useRef<SquarePaymentMethod | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [applePay, setApplePay] = useState<SquarePaymentMethod | null>(null);
  const [googlePay, setGooglePay] = useState<SquarePaymentMethod | null>(null);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isSquareConfigured || !cardRef.current) return;
    let cancelled = false;
    let card: SquarePaymentMethod | undefined;

    (async () => {
      try {
        const payments = await createPayments();
        if (cancelled) return;
        paymentsRef.current = payments;

        card = await payments.card({ style: { input: { fontSize: "16px" } } });
        // The ref can go null if the component unmounted mid-await.
        if (cancelled || !cardRef.current) return;
        await card.attach(cardRef.current);
        if (cancelled) return;

        cardInstanceRef.current = card;
        setCardReady(true);
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setSquareError(
            error instanceof Error ? error.message : "Couldn't load the payment form.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      card?.destroy?.();
      cardInstanceRef.current = null;
    };
  }, []);

  // Digital wallets embed the amount, so they're rebuilt whenever it changes.
  useEffect(() => {
    const payments = paymentsRef.current;
    if (!payments || grandTotal <= 0) return;
    let cancelled = false;

    (async () => {
      const request = buildPaymentRequest(payments, grandTotal);
      // Either wallet may be unavailable (wrong browser, unverified domain);
      // that's expected, so failures just hide the button.
      const [apple, google] = await Promise.allSettled([
        payments.applePay(request),
        payments.googlePay(request),
      ]);
      if (cancelled) return;
      setApplePay(apple.status === "fulfilled" ? apple.value : null);
      setGooglePay(google.status === "fulfilled" ? google.value : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [grandTotal]);

  // ------------------------------------------------------------ submit ----
  const validate = useCallback((): string | null => {
    if (!name.trim()) return "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
      return "Please enter a valid email address.";
    if (phone.replace(/\D/g, "").length < 10) return "Please enter a 10-digit phone number.";
    if (fulfillment === "delivery" && address.trim().length < 8)
      return "Please enter your delivery address.";
    if (!when) return "Please choose a pickup time.";
    return null;
  }, [name, email, phone, fulfillment, address, when]);

  const pay = useCallback(
    async (method: SquarePaymentMethod | null) => {
      const problem = validate();
      if (problem) {
        toast.error(problem);
        return;
      }
      const payments = paymentsRef.current;
      if (!method || !payments) {
        toast.error("The payment form isn't ready yet.");
        return;
      }

      setSubmitting(true);
      try {
        const { token, verificationToken } = await tokenize(payments, method, grandTotal, {
          name,
          email,
        });

        const order = await placeOrder({
          sourceId: token,
          verificationToken,
          plates,
          extras,
          fulfillment,
          when,
          deliveryAddress: fulfillment === "delivery" ? address.trim() : undefined,
          tipCents,
          note: note.trim() || undefined,
          customer: { name: name.trim(), email: email.trim(), phone: phone.trim() },
        });

        // Keep the cart until we've navigated, so a failed redirect isn't a
        // lost order; /track clears it on arrival.
        navigate({ to: "/track", search: { token: order.trackToken, new: true } });
      } catch (error) {
        const message =
          error instanceof ApiError || error instanceof Error
            ? error.message
            : "Payment failed. Please try again.";
        toast.error(message, { duration: 8000 });
        setSubmitting(false);
      }
    },
    [
      validate,
      grandTotal,
      name,
      email,
      phone,
      plates,
      extras,
      fulfillment,
      when,
      address,
      tipCents,
      note,
      navigate,
    ],
  );

  if (plates.length === 0) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-4xl font-black">Checkout</h1>
          <p className="mt-3 text-muted-foreground">
            Add at least one spaghetti plate to start your order.
          </p>
          <Button asChild variant="lab" size="xl" className="mt-6">
            <Link to="/menu">Build a plate</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  if (!menu.acceptingOrders) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-4xl font-black">We're closed</h1>
          <p className="mt-3 text-muted-foreground">{menu.closedMessage}</p>
          <Button asChild variant="labGhost" size="xl" className="mt-6">
            <Link to="/menu">Back to the menu</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <h1 className="text-4xl font-black">Checkout</h1>

          <section className="lab-card space-y-4 p-5">
            <h2 className="text-xl font-bold">Pickup or delivery?</h2>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="chip"
                data-active={fulfillment === "pickup"}
                onClick={() => setFulfillment("pickup")}
              >
                Pickup
              </button>
              <button
                className="chip"
                data-active={fulfillment === "delivery"}
                onClick={() => setFulfillment("delivery")}
              >
                Delivery
              </button>
            </div>
            {fulfillment === "pickup" ? (
              <p className="text-sm text-muted-foreground">
                Pickup in Berryessa, San Jose. We email you the exact address as soon as your order
                is paid.
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="addr">Delivery address</Label>
                <Input
                  id="addr"
                  className="h-12"
                  placeholder="Street, city, ZIP"
                  autoComplete="street-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  We deliver within {settings.deliveryRadiusMiles} miles of{" "}
                  {settings.originPostalCode}. {formatMoney(menu.deliveryFee)}, free over{" "}
                  {formatMoney(menu.freeDeliveryOver)}. We check the address before charging you.
                </p>
              </div>
            )}
          </section>

          <section className="lab-card space-y-3 p-5">
            <h2 className="text-xl font-bold">When?</h2>
            {!asapAvailable && now && (
              <p className="text-sm text-muted-foreground">
                We're closed right now — pick a time slot below.
              </p>
            )}
            <select
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="Ready time"
              className="h-12 w-full rounded-xl border-2 border-ink bg-card px-3 font-semibold"
            >
              {asapAvailable && (
                <option value="asap">ASAP (ready in ~{menu.prepMinutes} min)</option>
              )}
              {slots.map((s) => (
                <option key={s.iso} value={s.iso}>
                  {s.label}
                </option>
              ))}
            </select>
          </section>

          <section className="lab-card grid gap-3 p-5">
            <h2 className="text-xl font-bold">Your details</h2>
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                className="h-12"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                className="h-12"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                className="h-12"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Your receipt and order updates go here.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note">Notes for the kitchen (optional)</Label>
              <Textarea
                id="note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
              />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="lab-card space-y-4 p-5">
            <h2 className="text-xl font-bold">Order summary</h2>
            <CartLines compact />

            <div className="space-y-2 border-t-2 border-dashed border-border pt-4">
              <p className="lab-label text-muted-foreground">Add a tip</p>
              <div className="grid grid-cols-4 gap-1.5">
                {TIP_PERCENTS.map((p) => (
                  <button
                    key={p}
                    className="chip !min-h-10 !px-2 text-xs"
                    data-active={tipPercent === p}
                    onClick={() => setTipPercent(p)}
                  >
                    {p === 0 ? "None" : `${p}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-between border-t-2 border-ink pt-3 font-mono text-lg font-bold">
              <span>Total</span>
              <span>{formatMoney(grandTotal)}</span>
            </div>

            {!isSquareConfigured ? (
              <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                Online payment isn't configured yet. Add your Square keys to enable checkout.
              </p>
            ) : (
              <div className="space-y-3">
                {(applePay || googlePay) && (
                  <div className="grid gap-2">
                    {applePay && (
                      <button
                        onClick={() => pay(applePay)}
                        disabled={submitting}
                        className="h-12 w-full rounded-xl border-2 border-ink bg-ink font-semibold text-background disabled:opacity-50"
                      >
                        Pay
                      </button>
                    )}
                    {googlePay && (
                      <button
                        onClick={() => pay(googlePay)}
                        disabled={submitting}
                        className="h-12 w-full rounded-xl border-2 border-ink bg-card font-semibold disabled:opacity-50"
                      >
                        Pay with Google Pay
                      </button>
                    )}
                    <div className="flex items-center gap-3 py-1">
                      <span className="h-px flex-1 bg-border" />
                      <span className="lab-label text-muted-foreground">or card</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  </div>
                )}

                <div
                  ref={cardRef}
                  className="min-h-[90px] rounded-xl border-2 border-ink bg-card p-2"
                />

                {squareError && (
                  <p className="text-sm font-semibold text-destructive">{squareError}</p>
                )}

                <Button
                  variant="lab"
                  size="xl"
                  className="w-full"
                  disabled={!cardReady || submitting}
                  onClick={() => pay(cardInstanceRef.current)}
                >
                  {submitting ? "Processing…" : `Pay ${formatMoney(grandTotal)}`}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Secured by Square. Your card details never touch our servers.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
