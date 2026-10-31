import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CUSTOMIZATIONS, EXTRAS, HEAT, PROTEINS, SIZES, formatMoney, type CustomId, type HeatId, type ProteinId, type SizeId } from "@/lib/menu";
import { platePrice } from "@/lib/pricing";
import { useCart } from "@/lib/cart";
import { Qty } from "./Qty";

function Step({ n, title, hint, children }: { n: string; title: string; hint?: string; children: React.ReactNode }) {
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

export function PlateBuilder() {
  const { addPlate, setOpen } = useCart();
  const [size, setSize] = useState<SizeId | null>(null);
  const [heat, setHeat] = useState<HeatId | null>(null);
  const [proteins, setProteins] = useState<Partial<Record<ProteinId, number>>>({});
  const [customs, setCustoms] = useState<CustomId[]>([]);

  const price = size ? platePrice({ id: "", size, heat: heat ?? "mild", proteins, customs }) : 0;
  const ready = size && heat;

  const add = () => {
    if (!size || !heat) return;
    addPlate({ size, heat, proteins, customs });
    toast.success("Plate added to your formula!", { action: { label: "View cart", onClick: () => setOpen(true) } });
    setSize(null); setHeat(null); setProteins({}); setCustoms([]);
  };

  return (
    <div className="lab-card space-y-6 p-5 sm:p-7">
      <Step n="01" title="Pick a size" hint="required">
        <div className="grid grid-cols-3 gap-2">
          {SIZES.map((s) => (
            <button key={s.id} type="button" className="chip flex-col !rounded-2xl !py-3" data-active={size === s.id} onClick={() => setSize(s.id)}>
              <span>{s.label}</span>
              <span className="font-mono text-xs">{formatMoney(s.price)}</span>
            </button>
          ))}
        </div>
      </Step>
      <Step n="02" title="Heat level" hint="required">
        <div className="grid grid-cols-2 gap-2">
          {HEAT.map((h) => (
            <button key={h.id} type="button" className="chip" data-active={heat === h.id} onClick={() => setHeat(h.id)}>
              {h.id === "spicy" ? "🌶️ " : "🍅 "}{h.label}
            </button>
          ))}
        </div>
      </Step>
      <Step n="03" title="Add protein" hint="$4 each · stack as many as you like">
        <div className="space-y-2">
          {PROTEINS.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-muted px-4 py-2">
              <span className="font-semibold">{p.label}</span>
              <Qty label={p.label} value={proteins[p.id] ?? 0} onChange={(n) => setProteins((s) => ({ ...s, [p.id]: n }))} />
            </div>
          ))}
        </div>
      </Step>
      <Step n="04" title="Customize" hint="$1 each">
        <div className="flex flex-wrap gap-2">
          {CUSTOMIZATIONS.map((c) => {
            const on = customs.includes(c.id);
            return (
              <button key={c.id} type="button" className="chip" data-active={on} aria-pressed={on}
                onClick={() => setCustoms((s) => (on ? s.filter((x) => x !== c.id) : [...s, c.id]))}>
                {c.label} +$1
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
  return (
    <div className="lab-card space-y-2 p-5 sm:p-7">
      <p className="font-display text-lg font-bold">Sides & drinks</p>
      {EXTRAS.map((e) => (
        <div key={e.id} className="flex items-center justify-between rounded-xl bg-muted px-4 py-2">
          <div>
            <p className="font-semibold">{e.label}</p>
            <p className="font-mono text-xs text-muted-foreground">{formatMoney(e.price)}</p>
          </div>
          <Qty label={e.label} value={extras[e.id] ?? 0} onChange={(n) => setExtra(e.id, n)} />
        </div>
      ))}
    </div>
  );
}
