import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageShell } from "@/components/site/Layout";
import { CartLines } from "@/components/site/CartDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCart } from "@/lib/cart";
import { pageMeta } from "@/lib/seo";
import { availableSlots, canOrderAsap } from "@/lib/schedule";

export const Route = createFileRoute("/order")({
  head: () => ({
    ...pageMeta(
      "Checkout — Pickup or Delivery | Spaghetti Lab",
      "Choose pickup in Berryessa or delivery within 5 miles of 95131, pick ASAP or a scheduled time, and place your Spaghetti Lab order.",
      "/order",
    ),
  }),
  component: OrderPage,
});

function OrderPage() {
  const { plates, fulfillment, setFulfillment } = useCart();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  const slots = useMemo(() => (now ? availableSlots(now) : []), [now]);
  const asap = now ? canOrderAsap(now) : false;
  const [when, setWhen] = useState<string>("");
  useEffect(() => { if (!when && now) setWhen(asap ? "asap" : `${slots[0]?.day}-${slots[0]?.minutes}`); }, [now, asap, slots, when]);

  if (plates.length === 0) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-4xl font-black">Checkout</h1>
          <p className="mt-3 text-muted-foreground">Add at least one spaghetti plate to start your order.</p>
          <Button asChild variant="lab" size="xl" className="mt-6"><Link to="/menu">Build a plate</Link></Button>
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
              <button className="chip" data-active={fulfillment === "pickup"} onClick={() => setFulfillment("pickup")}>Pickup</button>
              <button className="chip" data-active={fulfillment === "delivery"} onClick={() => setFulfillment("delivery")}>Delivery</button>
            </div>
            {fulfillment === "pickup" ? (
              <p className="text-sm text-muted-foreground">Pickup in Berryessa, San Jose. The exact address is shown after your order is placed.</p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="addr">Delivery address</Label>
                <Input id="addr" className="h-12" placeholder="Street, city, ZIP" autoComplete="street-address" />
                <p className="text-xs text-muted-foreground">We deliver within 5 miles of 95131. $7, free over $60.</p>
              </div>
            )}
          </section>

          <section className="lab-card space-y-3 p-5">
            <h2 className="text-xl font-bold">When?</h2>
            {!asap && now && <p className="text-sm text-muted-foreground">We're closed right now (open 12pm–8pm) — pick a time slot.</p>}
            <select value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Ready time"
              className="h-12 w-full rounded-xl border-2 border-ink bg-card px-3 font-semibold">
              {asap && <option value="asap">ASAP (ready in ~15 min)</option>}
              {slots.map((s) => <option key={`${s.day}-${s.minutes}`} value={`${s.day}-${s.minutes}`}>{s.label}</option>)}
            </select>
          </section>

          <section className="lab-card grid gap-3 p-5">
            <h2 className="text-xl font-bold">Your details</h2>
            <div className="grid gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" className="h-12" autoComplete="name" /></div>
            <div className="grid gap-1.5"><Label htmlFor="phone">Phone</Label><Input id="phone" className="h-12" type="tel" autoComplete="tel" /></div>
            <div className="grid gap-1.5"><Label htmlFor="email">Email</Label><Input id="email" className="h-12" type="email" autoComplete="email" /></div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="lab-card space-y-4 p-5">
            <h2 className="text-xl font-bold">Order summary</h2>
            <CartLines compact />
            <Button variant="lab" size="xl" className="w-full" disabled>Pay with Square — coming soon</Button>
            <p className="text-center text-xs text-muted-foreground">Online payment is being connected. Card, Apple Pay & Google Pay will be supported.</p>
          </div>
        </aside>
      </div>
    </PageShell>
  );
}
