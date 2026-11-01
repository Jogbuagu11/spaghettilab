import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useState } from "react";
import { PageShell } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitReview } from "@/lib/api";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/review")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? (search["token"] as string) : "",
  }),
  head: () => ({
    ...pageMeta(
      "Leave a review | Spaghetti Lab",
      "Tell us how your Spaghetti Lab order went.",
      "/review",
    ),
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { token } = Route.useSearch();
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [body, setBody] = useState("");

  const mutation = useMutation({
    mutationFn: () => submitReview(token, rating, body),
  });

  if (!token) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-3xl font-black">Review link needed</h1>
          <p className="mt-3 text-muted-foreground">
            Use the link in the email we sent after your order.
          </p>
        </div>
      </PageShell>
    );
  }

  if (mutation.isSuccess) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <p className="text-5xl">🍝</p>
          <h1 className="mt-4 text-3xl font-black">Thank you!</h1>
          <p className="mt-3 text-muted-foreground">
            Your review is in. We read every single one — it genuinely helps a small kitchen.
          </p>
          <Button asChild variant="lab" size="xl" className="mt-6">
            <Link to="/menu">Order again</Link>
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="mx-auto max-w-md px-4 py-14">
        <p className="lab-label text-primary">One quick favour</p>
        <h1 className="mt-1 text-4xl font-black">How did we do?</h1>
        <p className="mt-2 text-muted-foreground">Takes about thirty seconds.</p>

        <div className="lab-card mt-6 space-y-5 p-5">
          <div>
            <p className="lab-label text-muted-foreground">Your rating</p>
            <div className="mt-2 flex gap-1" onMouseLeave={() => setHovered(0)}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} star${value > 1 ? "s" : ""}`}
                  aria-pressed={rating === value}
                  onMouseEnter={() => setHovered(value)}
                  onClick={() => setRating(value)}
                  className="p-1"
                >
                  <Star
                    className={`size-9 transition-transform hover:scale-110 ${
                      value <= (hovered || rating)
                        ? "fill-primary text-primary"
                        : "text-muted-foreground"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="body" className="lab-label text-muted-foreground">
              Anything you'd like to add? (optional)
            </label>
            <Textarea
              id="body"
              rows={4}
              maxLength={1500}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="The large plate with double meatball was perfect…"
            />
          </div>

          {mutation.isError && (
            <p className="text-sm font-semibold text-destructive">
              {mutation.error instanceof Error
                ? mutation.error.message
                : "Couldn't save that — please try again."}
            </p>
          )}

          <Button
            variant="lab"
            size="xl"
            className="w-full"
            disabled={rating === 0 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Sending…" : "Submit review"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            We show your first name only, and publish reviews after a quick check.
          </p>
        </div>
      </div>
    </PageShell>
  );
}
