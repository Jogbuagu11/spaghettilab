import { Link } from "@tanstack/react-router";
import { Facebook, House, Instagram, Music2, ShoppingBag, Star, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { useCart } from "@/lib/cart";
import { formatMinutes } from "@/lib/schedule";
import { useStorefront } from "@/lib/storefront";
import { CartDrawer } from "./CartDrawer";

export function SiteHeader() {
  const { count, setOpen } = useCart();
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-black">
          <img src="/logo.png" alt="" width={32} height={32} className="size-8" aria-hidden />
          Spaghetti Lab
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-4">
          <Link
            to="/menu"
            className="hidden px-2 py-2 sm:block"
            activeProps={{ className: "text-primary" }}
          >
            Menu
          </Link>
          <Link
            to="/reviews"
            className="hidden px-2 py-2 sm:block"
            activeProps={{ className: "text-primary" }}
          >
            Reviews
          </Link>
          <Link
            to="/order"
            className="hidden px-2 py-2 sm:block"
            activeProps={{ className: "text-primary" }}
          >
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
  const { hours, settings } = useStorefront();

  // Collapse the week into "Open 7 days · 12pm – 8pm" when every open day
  // shares the same window, which is the common case.
  const openDays = hours.filter((h) => !h.is_closed);
  const first = openDays[0];
  const uniform =
    first !== undefined &&
    openDays.every(
      (h) => h.open_minute === first.open_minute && h.close_minute === first.close_minute,
    );

  const socials = [
    { icon: Instagram, label: "Instagram", url: settings.instagramUrl },
    { icon: Music2, label: "TikTok", url: settings.tiktokUrl },
    { icon: Facebook, label: "Facebook", url: settings.facebookUrl },
    { icon: House, label: "Nextdoor", url: settings.nextdoorUrl },
    { icon: Utensils, label: "Yelp", url: settings.yelpUrl },
    { icon: Star, label: "Google reviews", url: settings.googleReviewUrl },
  ].filter((s) => Boolean(s.url));

  return (
    <footer className="mt-20 border-t-2 border-ink bg-ink text-background">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <p className="flex items-center gap-2 font-display text-2xl font-black">
            <img src="/logo.png" alt="" width={36} height={36} className="size-9" aria-hidden />
            Spaghetti Lab
          </p>
          <p className="mt-2 text-sm opacity-80">
            Fresh spaghetti pickup &amp; delivery in Berryessa, North San Jose. Serving{" "}
            {settings.originPostalCode}, Milpitas and nearby.
          </p>
          <p className="lab-label mt-4 inline-block rounded-full border border-background/40 px-3 py-1">
            Permitted MEHKO — Santa Clara County
          </p>
        </div>

        <div>
          <p className="lab-label opacity-70">Hours</p>
          {uniform ? (
            <p className="mt-2">
              Open {openDays.length === 7 ? "7 days" : `${openDays.length} days`} ·{" "}
              {formatMinutes(first.open_minute)} – {formatMinutes(first.close_minute)}
            </p>
          ) : (
            <ul className="mt-2 space-y-0.5 text-sm">
              {hours.map((h) => (
                <li key={h.day_of_week}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][h.day_of_week]}:{" "}
                  {h.is_closed
                    ? "Closed"
                    : `${formatMinutes(h.open_minute)} – ${formatMinutes(h.close_minute)}`}
                </li>
              ))}
            </ul>
          )}
          <p className="lab-label mt-4 opacity-70">Contact</p>
          <p className="mt-2 text-sm">
            <a href={`mailto:${settings.contactEmail}`} className="underline">
              {settings.contactEmail}
            </a>
            {settings.contactPhone && (
              <>
                <br />
                <a href={`tel:${settings.contactPhone}`} className="underline">
                  {settings.contactPhone}
                </a>
              </>
            )}
          </p>
        </div>

        <div>
          <p className="lab-label opacity-70">Follow the experiments</p>
          {socials.length > 0 ? (
            <div className="mt-3 flex gap-3">
              {socials.map(({ icon: Icon, label, url }) => (
                <a
                  key={label}
                  href={url!}
                  target="_blank"
                  rel="noreferrer me"
                  aria-label={label}
                  className="rounded-full border border-background/40 p-3 hover:bg-background/10"
                >
                  <Icon className="size-5" />
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm opacity-70">Social links coming soon.</p>
          )}
          <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link to="/menu" className="underline opacity-80 hover:opacity-100">
              Menu
            </Link>
            <Link to="/reviews" className="underline opacity-80 hover:opacity-100">
              Reviews
            </Link>
          </nav>
          <p className="mt-4 text-xs opacity-60">© {new Date().getFullYear()} Spaghetti Lab</p>
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
