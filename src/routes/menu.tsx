import { createFileRoute } from "@tanstack/react-router";
import { PageShell } from "@/components/site/Layout";
import { ExtrasPicker, PlateBuilder } from "@/components/site/PlateBuilder";
import { CartLines } from "@/components/site/CartDrawer";
import { pageMeta } from "@/lib/seo";
import { menuLd } from "@/lib/seo-data";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/menu")({
  head: () => ({
    ...pageMeta(
      "Menu — Build Your Spaghetti Plate | Spaghetti Lab San Jose",
      "Spaghetti plates from $12. Add meatballs, sausage or minced pork, choose spicy or not, plus garlic bread and drinks. Pickup or delivery in Berryessa, San Jose.",
      "/menu",
    ),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(menuLd) }],
  }),
  component: MenuPage,
});

function MenuPage() {
  const { count } = useCart();
  return (
    <PageShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <p className="lab-label text-primary">The formula</p>
        <h1 className="mt-1 text-4xl font-black sm:text-5xl">Build your spaghetti plate</h1>
        <p className="mt-2 text-muted-foreground">Meatball spaghetti, spicy sausage, or your own mix. Add as many plates as you like — each one customized.</p>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <PlateBuilder />
            <ExtrasPicker />
          </div>
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="lab-card p-5">
              <p className="font-display text-xl font-bold">Your order</p>
              <div className="mt-3">
                {count === 0 ? <p className="text-sm text-muted-foreground">No plates yet. Start with Step 01.</p> : <CartLines />}
              </div>
              {count > 0 && (
                <Button asChild variant="lab" size="xl" className="mt-4 w-full"><Link to="/order">Checkout</Link></Button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
