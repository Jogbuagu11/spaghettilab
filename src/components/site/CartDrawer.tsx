import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { STATIC_MENU, formatMoney, type MenuData } from "@/lib/menu";
import { orderTotals, platePrice, type Plate } from "@/lib/pricing";
import { useStorefront } from "@/lib/storefront";

export function describePlate(p: Plate, menu: MenuData = STATIC_MENU) {
  const parts: string[] = [];
  const heat = menu.heat.find((h) => h.id === p.heat);
  if (heat) parts.push(heat.label);
  menu.proteins.forEach((pr) => {
    const n = p.proteins[pr.id as keyof typeof p.proteins] ?? 0;
    if (n) parts.push(`${n}× ${pr.label}`);
  });
  menu.customizations.forEach((c) => p.customs.includes(c.id as never) && parts.push(c.label));
  return parts.join(" · ");
}

export function CartLines({ compact = false }: { compact?: boolean }) {
  const { plates, extras, removePlate, fulfillment } = useCart();
  const { menu } = useStorefront();
  const t = orderTotals(plates, extras, fulfillment, menu.taxRate, menu);
  return (
    <div className="space-y-3">
      {plates.map((p, i) => (
        <div key={p.id} className="flex items-start justify-between gap-3 rounded-xl bg-muted p-3">
          <div>
            <p className="font-semibold">
              Plate #{i + 1} — {menu.sizes.find((s) => s.id === p.size)?.label ?? p.size}
            </p>
            <p className="text-sm text-muted-foreground">{describePlate(p, menu)}</p>
          </div>
          <div className="flex items-center gap-1">
            <span className="font-mono font-bold">{formatMoney(platePrice(p, menu))}</span>
            {!compact && (
              <button
                onClick={() => removePlate(p.id)}
                aria-label={`Remove plate ${i + 1}`}
                className="p-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        </div>
      ))}
      {menu.extras
        .filter((e) => (extras[e.id as keyof typeof extras] ?? 0) > 0)
        .map((e) => {
          const qty = extras[e.id as keyof typeof extras] ?? 0;
          return (
            <div key={e.id} className="flex justify-between px-3 text-sm">
              <span>
                {qty}× {e.label}
              </span>
              <span className="font-mono">{formatMoney(e.price * qty)}</span>
            </div>
          );
        })}
      <div className="space-y-1 border-t-2 border-dashed border-border pt-3 font-mono text-sm">
        <Row k="Subtotal" v={formatMoney(t.subtotal)} />
        {fulfillment === "delivery" && (
          <Row k="Delivery" v={t.delivery ? formatMoney(t.delivery) : "FREE"} />
        )}
        <Row k="Est. tax" v={formatMoney(t.tax)} />
        <Row k="Total" v={formatMoney(t.total)} bold />
      </div>
      {t.untilFree > 0 && (
        <p className="rounded-xl bg-accent p-3 text-sm font-semibold text-accent-foreground">
          Add {formatMoney(t.untilFree)} more for free delivery 🧪
        </p>
      )}
    </div>
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

export function CartDrawer() {
  const { open, setOpen, plates, count } = useCart();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto bg-background sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Your formula</SheetTitle>
        </SheetHeader>
        {count === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <p className="text-5xl">🧪</p>
            <p className="text-muted-foreground">Your beaker is empty.</p>
            <Button asChild variant="lab" size="xl" onClick={() => setOpen(false)}>
              <Link to="/menu">Build a plate</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1">
              <CartLines />
            </div>
            <div className="grid gap-2">
              <Button
                asChild
                variant="lab"
                size="xl"
                onClick={() => setOpen(false)}
                disabled={plates.length === 0}
              >
                <Link to="/order">Checkout</Link>
              </Button>
              <Button asChild variant="labGhost" size="xl" onClick={() => setOpen(false)}>
                <Link to="/menu">Add another plate</Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
