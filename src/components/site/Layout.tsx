import { Link } from "@tanstack/react-router";
import { FlaskConical, Instagram, Facebook, ShoppingBag, Music2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCart } from "@/lib/cart";
import { CartDrawer } from "./CartDrawer";

export function SiteHeader() {
  const { count, setOpen } = useCart();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-black">
          <FlaskConical className="size-6 text-primary" aria-hidden />
          Spaghetti Lab
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-4">
          <Link to="/menu" className="hidden px-2 py-2 sm:block" activeProps={{ className: "text-primary" }}>
            Menu
          </Link>
          <Link to="/order" className="hidden px-2 py-2 sm:block" activeProps={{ className: "text-primary" }}>
            Checkout
          </Link>
          <button
            onClick={() => setOpen(true)}
            className="chip"
            aria-label={`Open cart, ${count} items`}
          >
            <ShoppingBag className="size-4" aria-hidden />
            <span>{count}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t-2 border-ink bg-ink text-background">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <p className="font-display text-2xl font-black">Spaghetti Lab</p>
          <p className="mt-2 text-sm opacity-80">
            Fresh spaghetti pickup & delivery in Berryessa, North San Jose. Serving 95131, Milpitas and nearby.
          </p>
          <p className="lab-label mt-4 inline-block rounded-full border border-background/40 px-3 py-1">
            Permitted MEHKO — Santa Clara County
          </p>
        </div>
        <div>
          <p className="lab-label opacity-70">Hours</p>
          <p className="mt-2">Open 7 days · 12pm – 8pm</p>
          <p className="text-sm opacity-80">Ready in about 15 minutes</p>
          <p className="lab-label mt-4 opacity-70">Contact</p>
          <p className="mt-2 text-sm">hello@spaghettilab.com</p>
        </div>
        <div>
          <p className="lab-label opacity-70">Follow the experiments</p>
          <div className="mt-3 flex gap-3">
            {[
              { icon: Instagram, label: "Instagram" },
              { icon: Music2, label: "TikTok" },
              { icon: Facebook, label: "Facebook" },
            ].map(({ icon: Icon, label }) => (
              <a key={label} href="#" aria-label={label} className="rounded-full border border-background/40 p-3 hover:bg-background/10">
                <Icon className="size-5" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <CartDrawer />
    </div>
  );
}
