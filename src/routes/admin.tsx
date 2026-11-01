import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateOrderStatus } from "@/lib/api";
import { formatMoney } from "@/lib/menu";
import { formatMinutes } from "@/lib/schedule";
import { pageMeta } from "@/lib/seo";
import type {
  BusinessHourRow,
  MenuOptionRow,
  OrderItemRow,
  OrderRow,
  ReviewRow,
  SettingsRow,
} from "@/lib/db-types";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin")({
  head: () => ({
    ...pageMeta("Admin | Spaghetti Lab", "Kitchen dashboard.", "/admin"),
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminPage,
});

const TABS = ["Orders", "Menu", "Hours", "Settings", "Reviews"] as const;
type Tab = (typeof TABS)[number];

function AdminPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("Orders");

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email ?? null);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (checking) {
    return <Centered>Checking your session…</Centered>;
  }
  if (!isSupabaseConfigured) {
    return <Centered>Supabase isn't configured for this deployment yet.</Centered>;
  }
  if (!email) {
    return <AdminLogin />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b-2 border-ink bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" width={32} height={32} />
            <span className="font-display text-xl font-black">Kitchen</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
            <Button variant="labGhost" size="sm" onClick={() => supabase.auth.signOut()}>
              Sign out
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {TABS.map((t) => (
            <button
              key={t}
              className="chip !min-h-9 shrink-0 !px-3 text-sm"
              data-active={tab === t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === "Orders" && <OrdersTab />}
        {tab === "Menu" && <MenuTab />}
        {tab === "Hours" && <HoursTab />}
        {tab === "Settings" && <SettingsTab />}
        {tab === "Reviews" && <ReviewsTab />}
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-muted-foreground">
      {children}
    </div>
  );
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/admin` },
      });
      if (error) throw error;
    },
    onSuccess: () => setSent(true),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Couldn't send the link."),
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="lab-card w-full max-w-sm space-y-4 p-6">
        <img src="/logo.png" alt="" width={56} height={56} className="mx-auto" />
        <h1 className="text-center font-display text-2xl font-black">Kitchen sign-in</h1>
        {sent ? (
          <p className="text-center text-sm text-muted-foreground">
            Check <strong>{email}</strong> for a sign-in link.
          </p>
        ) : (
          <>
            <p className="text-center text-sm text-muted-foreground">
              We'll email you a one-time sign-in link.
            </p>
            <Input
              type="email"
              className="h-12"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send.mutate()}
            />
            <Button
              variant="lab"
              size="xl"
              className="w-full"
              disabled={!email.includes("@") || send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending ? "Sending…" : "Email me a link"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- orders ----

const LIVE_STATUSES = ["paid", "preparing", "ready", "out_for_delivery"];

/** Which buttons to offer, mirroring the transitions the edge function allows. */
const NEXT_STATUS: Record<
  string,
  { status: string; label: string; variant?: "lab" | "labGhost" }[]
> = {
  paid: [
    { status: "preparing", label: "Start cooking", variant: "lab" },
    { status: "cancelled", label: "Cancel + refund", variant: "labGhost" },
  ],
  preparing: [
    { status: "ready", label: "Ready", variant: "lab" },
    { status: "out_for_delivery", label: "Out for delivery", variant: "lab" },
    { status: "cancelled", label: "Cancel + refund", variant: "labGhost" },
  ],
  ready: [
    { status: "completed", label: "Picked up", variant: "lab" },
    { status: "out_for_delivery", label: "Out for delivery", variant: "labGhost" },
  ],
  out_for_delivery: [{ status: "completed", label: "Delivered", variant: "lab" }],
};

function OrdersTab() {
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["admin-orders", showAll],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("*, order_items (label, quantity, total_price_cents, config, sort_order)")
        .order("created_at", { ascending: false })
        .limit(showAll ? 100 : 40);
      if (!showAll) query = query.in("status", LIVE_STATUSES);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as OrderRow[];
    },
    // The kitchen leaves this open on a tablet; keep it current.
    refetchInterval: 20_000,
  });

  const move = useMutation({
    mutationFn: (input: { orderId: string; status: string; reason?: string; refund?: boolean }) =>
      updateOrderStatus(input),
    onSuccess: (result) => {
      toast.success(result.refunded ? "Cancelled and refunded." : "Order updated.");
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed."),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading orders…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-black">
          {showAll ? "All orders" : "Live orders"}
        </h1>
        <Button variant="labGhost" size="sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show live only" : "Show all"}
        </Button>
      </div>

      {(orders ?? []).length === 0 && (
        <p className="lab-card p-6 text-center text-muted-foreground">Nothing cooking right now.</p>
      )}

      {(orders ?? []).map((order) => (
        <div key={order.id} className="lab-card space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-display text-xl font-bold">
                {order.order_number}
                <span className="ml-2 rounded-full border-2 border-ink bg-muted px-2 py-0.5 align-middle text-xs font-semibold uppercase">
                  {order.status.replace(/_/g, " ")}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {order.fulfillment === "pickup" ? "Pickup" : "Delivery"} ·{" "}
                {order.ready_at
                  ? new Intl.DateTimeFormat("en-US", {
                      timeZone: "America/Los_Angeles",
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(order.ready_at))
                  : "ASAP"}
              </p>
            </div>
            <p className="font-mono text-lg font-bold">{formatMoney(order.total_cents)}</p>
          </div>

          <div className="space-y-1 rounded-xl bg-muted p-3 text-sm">
            {(order.order_items ?? [])
              .sort((a: OrderItemRow, b: OrderItemRow) => a.sort_order - b.sort_order)
              .map((item, index) => (
                <p key={index}>
                  <strong>
                    {item.quantity > 1 ? `${item.quantity}× ` : ""}
                    {item.label}
                  </strong>
                  {item.config?.summary && (
                    <span className="text-muted-foreground"> — {item.config.summary}</span>
                  )}
                </p>
              ))}
            {order.customer_note && (
              <p className="mt-2 border-t border-border pt-2 text-muted-foreground">
                <strong className="text-foreground">Note:</strong> {order.customer_note}
              </p>
            )}
          </div>

          <p className="text-sm">
            <strong>{order.customer_name}</strong> ·{" "}
            <a href={`tel:${order.customer_phone}`} className="underline">
              {order.customer_phone}
            </a>
            {order.delivery_address && (
              <span className="block text-muted-foreground">{order.delivery_address}</span>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            {(NEXT_STATUS[order.status] ?? []).map((action) => (
              <Button
                key={action.status}
                variant={action.variant ?? "labGhost"}
                size="sm"
                disabled={move.isPending}
                onClick={() => {
                  if (action.status === "cancelled") {
                    const reason = window.prompt("Reason for cancelling? (shown to the customer)");
                    if (reason === null) return;
                    move.mutate({ orderId: order.id, status: "cancelled", reason, refund: true });
                  } else {
                    move.mutate({ orderId: order.id, status: action.status });
                  }
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ menu ----

function MenuTab() {
  const qc = useQueryClient();
  const { data: options } = useQuery({
    queryKey: ["admin-menu"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("menu_options")
        .select("*")
        .order("group_name")
        .order("sort_order");
      if (error) throw error;
      return data as MenuOptionRow[];
    },
  });

  const save = useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase.from("menu_options").update(input.patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Menu updated.");
      qc.invalidateQueries({ queryKey: ["admin-menu"] });
      qc.invalidateQueries({ queryKey: ["storefront"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed."),
  });

  const groups = ["size", "heat", "protein", "customization", "extra"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-black">Menu</h1>
        <p className="text-sm text-muted-foreground">
          Prices are in dollars. Changes go live immediately and are re-checked at checkout.
        </p>
      </div>

      {groups.map((group) => (
        <section key={group} className="lab-card p-4">
          <h2 className="lab-label mb-3 text-primary">{group}</h2>
          <div className="space-y-2">
            {(options ?? [])
              .filter((o) => o.group_name === group)
              .map((option) => (
                <div
                  key={option.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-muted px-3 py-2"
                >
                  <span className="min-w-36 flex-1 font-semibold">{option.label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={(option.price_cents / 100).toFixed(2)}
                      className="h-10 w-24"
                      onBlur={(e) => {
                        const cents = Math.round(Number(e.target.value) * 100);
                        if (!Number.isFinite(cents) || cents === option.price_cents) return;
                        save.mutate({ id: option.id, patch: { price_cents: cents } });
                      }}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={option.is_available}
                      onCheckedChange={(checked) =>
                        save.mutate({ id: option.id, patch: { is_available: checked } })
                      }
                    />
                    {option.is_available ? "Available" : "Sold out"}
                  </label>
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------- hours ----

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function HoursTab() {
  const qc = useQueryClient();
  const { data: hours } = useQuery({
    queryKey: ["admin-hours"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_hours")
        .select("*")
        .order("day_of_week");
      if (error) throw error;
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async (input: { day: number; patch: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("business_hours")
        .update(input.patch)
        .eq("day_of_week", input.day);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Hours updated.");
      qc.invalidateQueries({ queryKey: ["admin-hours"] });
      qc.invalidateQueries({ queryKey: ["storefront"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed."),
  });

  // 15-minute increments across the day.
  const timeOptions = Array.from({ length: 96 }, (_, i) => i * 15);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-black">Hours</h1>
        <p className="text-sm text-muted-foreground">All times are America/Los_Angeles.</p>
      </div>

      <div className="lab-card divide-y divide-border p-4">
        {(hours ?? []).map((day) => (
          <div key={day.day_of_week} className="flex flex-wrap items-center gap-3 py-3">
            <span className="w-28 font-semibold">{DAY_NAMES[day.day_of_week]}</span>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={!day.is_closed}
                onCheckedChange={(open) =>
                  save.mutate({ day: day.day_of_week, patch: { is_closed: !open } })
                }
              />
              {day.is_closed ? "Closed" : "Open"}
            </label>
            {!day.is_closed && (
              <div className="flex items-center gap-2">
                {(["open_minute", "close_minute"] as const).map((field) => (
                  <select
                    key={field}
                    aria-label={`${DAY_NAMES[day.day_of_week]} ${field === "open_minute" ? "opening" : "closing"} time`}
                    value={day[field]}
                    onChange={(e) =>
                      save.mutate({
                        day: day.day_of_week,
                        patch: { [field]: Number(e.target.value) },
                      })
                    }
                    className="h-10 rounded-xl border-2 border-ink bg-card px-2 font-semibold"
                  >
                    {timeOptions.map((m) => (
                      <option key={m} value={m}>
                        {formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- settings ----

/** Everything the owner can change without a deploy. */
const SETTING_FIELDS: {
  key: string;
  label: string;
  hint?: string;
  type?: string;
  step?: string;
}[] = [
  {
    key: "pickup_address",
    label: "Pickup address",
    hint: "Only shown to customers after they've paid.",
  },
  { key: "contact_phone", label: "Contact phone", type: "tel" },
  { key: "contact_email", label: "Contact email", type: "email" },
  {
    key: "tax_rate",
    label: "Tax rate",
    hint: "As a decimal, e.g. 0.09375 for 9.375%.",
    type: "number",
    step: "0.00001",
  },
  { key: "delivery_fee_cents", label: "Delivery fee (cents)", type: "number" },
  { key: "free_delivery_over_cents", label: "Free delivery over (cents)", type: "number" },
  { key: "delivery_radius_miles", label: "Delivery radius (miles)", type: "number", step: "0.5" },
  { key: "prep_minutes", label: "Prep time (minutes)", type: "number" },
  { key: "instagram_url", label: "Instagram URL" },
  { key: "tiktok_url", label: "TikTok URL" },
  { key: "facebook_url", label: "Facebook URL" },
  { key: "google_review_url", label: "Google review URL" },
  { key: "yelp_url", label: "Yelp URL" },
  { key: "ga4_measurement_id", label: "GA4 measurement ID", hint: "e.g. G-XXXXXXXXXX" },
  { key: "meta_pixel_id", label: "Meta Pixel ID" },
];

function SettingsTab() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["admin-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data as SettingsRow;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from("settings").update(patch).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settings saved.");
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["storefront"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed."),
  });

  if (!settings) return <p className="text-muted-foreground">Loading settings…</p>;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-black">Settings</h1>

      <div className="lab-card space-y-3 p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="font-semibold">Accepting orders</span>
            <span className="block text-sm text-muted-foreground">
              Turning this off closes checkout immediately.
            </span>
          </span>
          <Switch
            checked={settings.is_accepting_orders}
            onCheckedChange={(checked) => save.mutate({ is_accepting_orders: checked })}
          />
        </label>
        <div className="grid gap-1.5">
          <Label htmlFor="closed_message">Closed message</Label>
          <Input
            id="closed_message"
            className="h-11"
            defaultValue={settings.closed_message ?? ""}
            onBlur={(e) =>
              e.target.value !== settings.closed_message &&
              save.mutate({ closed_message: e.target.value })
            }
          />
        </div>
      </div>

      <div className="lab-card grid gap-4 p-4 sm:grid-cols-2">
        {SETTING_FIELDS.map((field) => (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input
              id={field.key}
              type={field.type ?? "text"}
              step={field.step}
              className="h-11"
              defaultValue={String(settings[field.key] ?? "")}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const next = field.type === "number" ? Number(raw) : raw || null;
                if (String(settings[field.key] ?? "") === raw) return;
                save.mutate({ [field.key]: next });
              }}
            />
            {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- reviews ----

function ReviewsTab() {
  const qc = useQueryClient();
  const { data: reviews } = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("*, orders (order_number)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ReviewRow[];
    },
  });

  const publish = useMutation({
    mutationFn: async (input: { id: string; is_published: boolean }) => {
      const { error } = await supabase
        .from("reviews")
        .update({ is_published: input.is_published })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Review updated.");
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Save failed."),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-black">Reviews</h1>
        <p className="text-sm text-muted-foreground">
          Only published reviews appear on the site and in search results.
        </p>
      </div>

      {(reviews ?? []).length === 0 && (
        <p className="lab-card p-6 text-center text-muted-foreground">No reviews yet.</p>
      )}

      {(reviews ?? []).map((review) => (
        <div key={review.id} className="lab-card space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {"★".repeat(review.rating)}
              <span className="text-muted-foreground">{"★".repeat(5 - review.rating)}</span>
              <span className="ml-2 font-normal text-muted-foreground">
                {review.author_name} · {review.orders?.order_number ?? "—"}
              </span>
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={review.is_published}
                onCheckedChange={(checked) =>
                  publish.mutate({ id: review.id, is_published: checked })
                }
              />
              {review.is_published ? "Published" : "Hidden"}
            </label>
          </div>
          {review.body && <p className="text-sm text-muted-foreground">{review.body}</p>}
        </div>
      ))}
    </div>
  );
}
