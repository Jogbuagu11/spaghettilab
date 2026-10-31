import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, MapPin, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/site/Layout";
import { pageMeta, restaurantLd } from "@/lib/seo";
import hero from "@/assets/hero-spaghetti.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    ...pageMeta(
      "Spaghetti Lab | Fresh Spaghetti Pickup & Delivery in Berryessa, San Jose",
      "Build your own spaghetti plate — meatballs, sausage, spicy or not. Home kitchen pickup & delivery in Berryessa, North San Jose 95131 and Milpitas. Open daily 12–8pm.",
      "/",
    ),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(restaurantLd) }],
  }),
  component: Home,
});

const steps = [
  { n: "01", t: "Build your plate", d: "Pick a size, heat, proteins and extras." },
  { n: "02", t: "Pick a time", d: "ASAP during open hours, or schedule a slot." },
  { n: "03", t: "Pickup or delivery", d: "Grab it in Berryessa or we bring it to you." },
];

function Home() {
  return (
    <PageShell>
      <section className="bg-hero">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-2 md:py-20">
          <div>
            <p className="lab-label inline-block rounded-full border-2 border-ink bg-card px-3 py-1">
              🧪 Home kitchen · Berryessa, San Jose
            </p>
            <h1 className="mt-5 text-5xl font-black leading-[0.95] sm:text-7xl">
              Spaghetti <span className="text-primary">Lab</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-muted-foreground">
              Fresh spaghetti, mixed to your formula. Pickup & delivery across North San Jose, 95131 and Milpitas.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="lab" size="xl"><Link to="/menu">Order Now</Link></Button>
              <Button asChild variant="labGhost" size="xl"><Link to="/menu">Schedule an Order</Link></Button>
            </div>
          </div>
          <div className="relative">
            <img src={hero} alt="Bowl of spaghetti with meatballs, basil and parmesan next to a beaker of olive oil and a test tube of chili flakes"
              width={1280} height={1280} className="aspect-square w-full rounded-[2rem] border-2 border-ink object-cover shadow-pop" />
            <div className="lab-card absolute -bottom-4 -left-2 rotate-[-4deg] px-4 py-2 sm:-left-6">
              <p className="lab-label text-muted-foreground">Ready in</p>
              <p className="font-display text-2xl font-black">~15 min</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-black sm:text-4xl">How the experiment works</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="lab-card p-6">
              <p className="lab-label text-primary">Step {s.n}</p>
              <h3 className="mt-2 text-xl font-bold">{s.t}</h3>
              <p className="mt-1 text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4">
        <h2 className="text-3xl font-black sm:text-4xl">Spaghetti delivery in Berryessa & North San Jose</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Info icon={MapPin} title="Pickup in Berryessa">Exact address is shared once your order is placed.</Info>
          <Info icon={Truck} title="Delivery within 5 miles of 95131">$7 delivery — <strong>FREE</strong> on orders over $60 (before tax).</Info>
          <Info icon={Clock} title="Open 7 days, 12pm–8pm">Order anytime, 24/7. Outside hours, just schedule a slot.</Info>
        </div>
      </section>
    </PageShell>
  );
}

function Info({ icon: Icon, title, children }: { icon: typeof Clock; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-ink bg-secondary p-6 text-secondary-foreground">
      <Icon className="size-7" aria-hidden />
      <h3 className="mt-3 text-xl font-bold">{title}</h3>
      <p className="mt-1 opacity-90">{children}</p>
    </div>
  );
}
