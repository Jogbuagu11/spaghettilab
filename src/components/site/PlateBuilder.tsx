import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatMoney, type CustomId, type HeatId, type ProteinId, type SizeId } from "@/lib/menu";
import { platePrice } from "@/lib/pricing";
import { useCart } from "@/lib/cart";
import { useStorefront } from "@/lib/storefront";
import { Qty } from "./Qty";

function Step({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="flex items-baseline gap-2">
        <span className="lab-label text-primary">Step {n}</span>
        <span className="font-display text-lg font-bold">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

/** Sold-out options stay visible but unselectable, so the menu reads consistently. */
function SoldOut() {
  return <span className="ml-1 text-xs font-normal text-muted-foreground">Sold out</span>;
}

export function PlateBuilder() {
  const { addPlate, setOpen } = useCart();
  const { menu } = useStorefront();
  const [size, setSize] = useState<SizeId | null>(null);
  const [heat, setHeat] = useState<HeatId | null>(null);
  const [proteins, setProteins] = useState<Partial<Record<ProteinId, number>>>({});
  const [customs, setCustoms] = useState<CustomId[]>([]);

  const price = size
    ? platePrice({ id: "", size, heat: heat ?? "mild", proteins, customs }, menu)
    : 0;
  const ready = size && heat;

  // The cheapest protein and add-on drive the hint copy, so it tracks real prices.
  const proteinFrom = Math.min(...menu.proteins.map((p) => p.price));
  const customFrom = Math.min(...menu.customizations.map((c) => c.price));

  const add = () => {
    if (!size || !heat) return;
    addPlate({ size, heat, proteins, customs });
    toast.success("Plate added to your formula!", {
      action: { label: "View cart", onClick: () => setOpen(true) },
    });
    setSize(null);
    setHeat(null);
    setProteins({});
    setCustoms([]);
  };

  return (
    <div className="lab-card space-y-6 p-5 sm:p-7">
      <Step n="01" title="Pick a size" hint="required">
        <div className="grid grid-cols-3 gap-2">
          {menu.sizes.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip flex-col !rounded-2xl !py-3 disabled:opacity-40"
              data-active={size === s.id}
              disabled={!s.available}
              onClick={() => setSize(s.id as SizeId)}
            >
              <span>
                {s.label}
                {!s.available && <SoldOut />}
              </span>
              <span className="font-mono text-xs">{formatMoney(s.price)}</span>
            </button>
          ))}
        </div>
      </Step>

      <Step n="02" title="Heat level" hint="required">
        <div className="grid grid-cols-2 gap-2">
          {menu.heat.map((h) => (
            <button
              key={h.id}
              type="button"
              className="chip disabled:opacity-40"
              data-active={heat === h.id}
              disabled={!h.available}
              onClick={() => setHeat(h.id as HeatId)}
            >
              {h.id === "spicy" ? "🌶️ " : "🍅 "}
              {h.label}
              {!h.available && <SoldOut />}
            </button>
          ))}
        </div>
      </Step>

      <Step
        n="03"
        title="Add protein"
        hint={`${formatMoney(proteinFrom)} each · stack as many as you like`}
      >
        <div className="space-y-2">
          {menu.proteins.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl bg-muted px-4 py-2"
            >
              <span className="font-semibold">
                {p.label}
                <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                  {formatMoney(p.price)}
                </span>
                {!p.available && <SoldOut />}
              </span>
              {p.available ? (
                <Qty
                  label={p.label}
                  value={proteins[p.id as ProteinId] ?? 0}
                  onChange={(n) => setProteins((s) => ({ ...s, [p.id]: n }))}
                />
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          ))}
        </div>
      </Step>

      <Step n="04" title="Customize" hint={`${formatMoney(customFrom)} each`}>
        <div className="flex flex-wrap gap-2">
          {menu.customizations.map((c) => {
            const on = customs.includes(c.id as CustomId);
            return (
              <button
                key={c.id}
                type="button"
                className="chip disabled:opacity-40"
                data-active={on}
                aria-pressed={on}
                disabled={!c.available}
                onClick={() =>
                  setCustoms((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id as CustomId]))
                }
              >
                {c.label} +{formatMoney(c.price)}
                {!c.available && <SoldOut />}
              </button>
            );
          })}
        </div>
      </Step>

      <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-border pt-5">
        <div>
          <p className="lab-label text-muted-foreground">Plate total</p>
          <p className="font-mono text-2xl font-bold">{formatMoney(price)}</p>
        </div>
        <Button variant="lab" size="xl" disabled={!ready} onClick={add}>
          {ready ? "Add plate" : !size ? "Pick a size" : "Pick heat"}
        </Button>
      </div>
    </div>
  );
}

export function ExtrasPicker() {
  const { extras, setExtra } = useCart();
  const { menu } = useStorefront();

  return (
    <div className="lab-card space-y-2 p-5 sm:p-7">
      <p className="font-display text-lg font-bold">Sides &amp; drinks</p>
      {menu.extras.map((e) => (
        <div key={e.id} className="flex items-center justify-between rounded-xl bg-muted px-4 py-2">
          <div>
            <p className="font-semibold">
              {e.label}
              {!e.available && <SoldOut />}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{formatMoney(e.price)}</p>
          </div>
          {e.available ? (
            <Qty
              label={e.label}
              value={extras[e.id as keyof typeof extras] ?? 0}
              onChange={(n) => setExtra(e.id as never, n)}
            />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </div>
      ))}
    </div>
  );
}
