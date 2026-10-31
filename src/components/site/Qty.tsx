import { Minus, Plus } from "lucide-react";

export function Qty({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" className="chip !min-h-10 !px-3" onClick={() => onChange(Math.max(0, value - 1))} aria-label={`Remove one ${label}`} disabled={value === 0}>
        <Minus className="size-4" />
      </button>
      <span className="w-6 text-center font-mono font-bold" aria-live="polite">{value}</span>
      <button type="button" className="chip !min-h-10 !px-3" onClick={() => onChange(value + 1)} aria-label={`Add one ${label}`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
