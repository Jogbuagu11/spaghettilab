import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CreditCard,
  MapPin,
  PauseCircle,
  PlayCircle,
  SkipForward,
} from "lucide-react";
import { PageShell } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import {
  getSubscription,
  manageSubscription,
  type SubscriptionAction,
  type SubscriptionSummary,
} from "@/lib/api";
import { formatMinutes } from "@/lib/schedule";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/subscription")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? (search["token"] as string) : "",
    new: search["new"] === true || search["new"] === "true",
  }),
  head: () => ({
    ...pageMeta(
      "Your weekly order | Spaghetti Lab",
      "Skip a week, pause, or cancel your Spaghetti Lab standing order.",
      "/subscription",
    ),
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: SubscriptionPage,
});

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const STATUS_COPY: Record<SubscriptionSummary["status"], { label: string; tone: string }> = {
  active: { label: "Active", tone: "bg-secondary text-secondary-foreground" },
  paused: { label: "Paused", tone: "bg-muted text-muted-foreground" },
  payment_failed: { label: "Payment failed", tone: "bg-destructive text-destructive-foreground" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};

function formatDate(dateKey: string) {
  // Parse as a plain calendar date; the stored value has no timezone.
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(y!, m! - 1, d!));
}

function SubscriptionPage() {
  const { token, new: isNew } = Route.useSearch();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["subscription", token],
    queryFn: () => getSubscription(token),
    enabled: token.length > 0,
  });

  const act = useMutation({
    mutationFn: (action: SubscriptionAction) => manageSubscription(token, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subscription", token] }),
  });

  if (!token) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-3xl font-black">Nothing to manage</h1>
          <p className="mt-3 text-muted-foreground">
            Open the link from any of your weekly order emails.
          </p>
        </div>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center text-muted-foreground">
          Loading your weekly order…
        </div>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-3xl font-black">We couldn't find that</h1>
          <p className="mt-3 text-muted-foreground">The link may have expired or been mistyped.</p>
          <Button asChild variant="labGhost" size="xl" className="mt-6">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  const sub = data.subscription;
  const status = STATUS_COPY[sub.status];
  const live = sub.status === "active" || sub.status === "payment_failed";

  return (
    <PageShell>
      <div className="mx-auto max-w-2xl px-4 py-10">
        {isNew && (
          <div className="mb-6 rounded-xl border-2 border-ink bg-accent p-4 text-accent-foreground">
            <p className="font-display text-xl font-bold">You're all set! 🍝</p>
            <p className="mt-1 text-sm">
              Same plate, every week — and delivery is on us. We've emailed you this link so you can
              change it any time.
            </p>
          </div>
        )}

        <p className="lab-label text-primary">Standing order {sub.reference}</p>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-4xl font-black">
          Your weekly spaghetti
          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${status.tone}`}>
            {status.label}
          </span>
        </h1>

        <div className="lab-card mt-6 space-y-4 p-5">
          <div className="flex items-start gap-3">
            <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-bold">
                Every {DAY_NAMES[sub.day_of_week]} at {formatMinutes(sub.ready_minute)}
              </p>
              {sub.status === "active" && (
                <p className="text-sm text-muted-foreground">
                  Next: {formatDate(sub.next_run_date)}
                </p>
              )}
              {sub.status === "paused" && (
                <p className="text-sm text-muted-foreground">Paused — nothing will be charged.</p>
              )}
              {sub.status === "payment_failed" && (
                <p className="text-sm font-semibold text-destructive">
                  Your last payment was declined. We'll try again next week.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <p>
              {sub.fulfillment === "pickup"
                ? "Pickup — the address is on every receipt."
                : sub.delivery_address}
              {sub.fulfillment === "delivery" && (
                <span className="block text-sm text-muted-foreground">
                  Delivery is free on every weekly order.
                </span>
              )}
            </p>
          </div>

          {sub.card_brand && (
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <p>
                {sub.card_brand} ending {sub.card_last4}
                <span className="block text-sm text-muted-foreground">
                  Charged the morning of each order.
                </span>
              </p>
            </div>
          )}
        </div>

        {data.skippedDates.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Skipping: {data.skippedDates.map(formatDate).join(", ")}
          </p>
        )}

        {act.isError && (
          <p className="mt-4 text-sm font-semibold text-destructive">
            {act.error instanceof Error
              ? act.error.message
              : "That didn't work — please try again."}
          </p>
        )}

        {sub.status !== "cancelled" ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {live && (
              <>
                <Button
                  variant="labGhost"
                  size="xl"
                  disabled={act.isPending}
                  onClick={() => act.mutate("skip_next")}
                >
                  <SkipForward className="mr-2 size-4" aria-hidden />
                  Skip next week
                </Button>
                <Button
                  variant="labGhost"
                  size="xl"
                  disabled={act.isPending}
                  onClick={() => act.mutate("pause")}
                >
                  <PauseCircle className="mr-2 size-4" aria-hidden />
                  Pause
                </Button>
              </>
            )}
            {sub.status === "paused" && (
              <Button
                variant="lab"
                size="xl"
                disabled={act.isPending}
                onClick={() => act.mutate("resume")}
              >
                <PlayCircle className="mr-2 size-4" aria-hidden />
                Resume
              </Button>
            )}
            <Button
              variant="labGhost"
              size="xl"
              disabled={act.isPending}
              onClick={() => {
                if (window.confirm("Cancel your weekly order? This can't be undone.")) {
                  act.mutate("cancel");
                }
              }}
            >
              Cancel for good
            </Button>
          </div>
        ) : (
          <div className="mt-6">
            <p className="text-muted-foreground">
              This standing order is cancelled and your card has been removed.
            </p>
            <Button asChild variant="lab" size="xl" className="mt-4">
              <Link to="/menu">Start a new one</Link>
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
