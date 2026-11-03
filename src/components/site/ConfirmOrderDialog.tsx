/**
 * Last look before the card is charged.
 *
 * Shows the whole order back to the customer and, while they're still here,
 * offers the two things people most often forget: parmesan on the plates and
 * something to drink. Both nudges disappear the moment the basket has them.
 *
 * Adding an upsell re-prices everything live, which matters for the wallet
 * buttons: Apple Pay and Google Pay bake the amount into their instance, so
 * the confirm button waits for them to be rebuilt rather than charging against
 * a sheet that shows the old total.
 */

import { Check, Plus } from "lucide-react";
import { CartLines } from "@/components/site/CartDrawer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney, type CustomId, type ExtraId, type MenuData } from "@/lib/menu";
import type { Fulfillment, orderTotals, Plate } from "@/lib/pricing";
import { findUpsells, hasUpsells } from "@/lib/upsell";

export interface ConfirmOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plates: Plate[];
  extras: Partial<Record<ExtraId, number>>;
  menu: MenuData;
  totals: ReturnType<typeof orderTotals>;
  fulfillment: Fulfillment;
  /** Human-readable "when", e.g. "ASAP (~15 min)" or "Every Tuesday, 6:00 PM". */
  whenLabel: string;
  deliveryAddress: string;
  tipPercent: number;
  tipCents: number;
  grandTotal: number;
  /** True for a weekly standing order — the copy and button change. */
  weekly: boolean;
  /** False while the wallet buttons are still catching up with a new total. */
  amountReady: boolean;
  /**
   * The earliest slot that would make delivery free, when lead time is the
   * only thing missing. Offered here rather than as a toast: Radix blocks
   * pointer events outside the dialog, so a toast behind it can't be tapped.
   */
  freeSlot: { iso: string; label: string } | null;
  onUseFreeSlot: (iso: string) => void;
  submitting: boolean;
  onAddCustom: (custom: CustomId, plateIds: string[]) => void;
  onAddExtra: (extra: ExtraId) => void;
  onConfirm: () => void;
}

export function ConfirmOrderDialog({
  open,
  onOpenChange,
  plates,
  extras,
  menu,
  totals,
  fulfillment,
  whenLabel,
  deliveryAddress,
  tipPercent,
  tipCents,
  grandTotal,
  weekly,
  amountReady,
  freeSlot,
  onUseFreeSlot,
  submitting,
  onAddCustom,
  onAddExtra,
  onConfirm,
}: ConfirmOrderDialogProps) {
  const upsells = findUpsells(plates, extras, menu);
  const showAnything = hasUpsells(upsells) || freeSlot !== null;
  const n = upsells.cheese?.plateIds.length ?? 0;
  const plateWord = n > 2 ? `All ${n} plates` : n === 2 ? "Both plates" : "This plate";

  return (
    // Esc and the backdrop stop working mid-charge: closing then wouldn't
    // cancel the payment, it would just hide what's happening.
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto border-2 border-ink">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-black">
            {weekly ? "Confirm your weekly order" : "Confirm your order"}
          </DialogTitle>
          <DialogDescription>
            {fulfillment === "delivery" ? "Delivery" : "Pickup"} · {whenLabel}
            {fulfillment === "delivery" && deliveryAddress ? ` · ${deliveryAddress}` : ""}
          </DialogDescription>
        </DialogHeader>

        <CartLines
          compact
          totals={totals}
          tip={{ percent: tipPercent, cents: tipCents }}
          totalLabel={weekly ? "Charged weekly" : "Total"}
        />

        {showAnything && (
          <div className="space-y-3 rounded-2xl border-2 border-dashed border-border p-4">
            <p className="lab-label text-muted-foreground">Before you go</p>

            {upsells.cheese && (
              <UpsellRow
                emoji="🧀"
                // Named from the menu row rather than hard-coded, so renaming
                // it in the admin doesn't leave checkout offering a ghost.
                title={`Add ${upsells.cheese.item.label.toLowerCase()}?`}
                action={`${plateWord} · +${formatMoney(upsells.cheese.priceCents)}`}
                onAdd={() =>
                  onAddCustom(
                    upsells.cheese!.item.id as CustomId,
                    // Snapshot: by the time this fires the list is still the
                    // one rendered, so it can't sweep up a newly added plate.
                    upsells.cheese!.plateIds,
                  )
                }
              />
            )}

            {upsells.drinks.length > 0 && (
              <UpsellRow
                emoji="🥤"
                title="Anything to drink?"
                buttons={upsells.drinks.map((d) => ({
                  label: `${d.label} · +${formatMoney(d.price)}`,
                  onAdd: () => onAddExtra(d.id as ExtraId),
                }))}
              />
            )}

            {freeSlot && (
              <UpsellRow
                emoji="🚚"
                title="Wait a little and delivery is free"
                action={`Move to ${freeSlot.label}`}
                onAdd={() => onUseFreeSlot(freeSlot.iso)}
              />
            )}
          </div>
        )}

        {weekly && (
          <p className="text-xs text-muted-foreground">
            We'll make this every week and charge your card the morning of. Skip or cancel any time
            from the link in your email.
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
          <Button
            variant="labGhost"
            size="xl"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Keep editing
          </Button>
          <Button variant="lab" size="xl" disabled={submitting || !amountReady} onClick={onConfirm}>
            {submitting ? (
              "Processing…"
            ) : !amountReady ? (
              "Updating…"
            ) : (
              <>
                <Check className="size-5" />
                {weekly ? "Start weekly order" : `Place order · ${formatMoney(grandTotal)}`}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UpsellRow({
  emoji,
  title,
  action,
  onAdd,
  buttons,
}: {
  emoji: string;
  title: string;
  action?: string;
  onAdd?: () => void;
  buttons?: { label: string; onAdd: () => void }[];
}) {
  const all = buttons ?? (action && onAdd ? [{ label: action, onAdd }] : []);
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">
        {emoji} {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {all.map((b) => (
          <button
            key={b.label}
            onClick={b.onAdd}
            className="chip !min-h-10 gap-1 !px-3 text-sm"
            type="button"
          >
            <Plus className="size-4" />
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
