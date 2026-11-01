import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { PageShell } from "@/components/site/Layout";
import { Button } from "@/components/ui/button";
import { absolute, pageMeta, SITE, SITE_URL } from "@/lib/seo";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

interface PublishedReview {
  id: string;
  rating: number;
  body: string | null;
  author_name: string;
  created_at: string;
}

export const Route = createFileRoute("/reviews")({
  head: () => ({
    ...pageMeta(
      "Reviews — What our customers say | Spaghetti Lab",
      "Verified reviews from real Spaghetti Lab orders in Berryessa, San Jose. Every review comes from a customer who actually ordered.",
      "/reviews",
    ),
  }),
  component: ReviewsPage,
});

function Stars({ rating, className = "size-4" }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${className} ${n <= rating ? "fill-primary text-primary" : "text-border"}`}
          aria-hidden
        />
      ))}
    </span>
  );
}

function ReviewsPage() {
  const { data: reviews, isLoading } = useQuery({
    queryKey: ["published-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, body, author_name, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as PublishedReview[];
    },
    enabled: isSupabaseConfigured,
  });

  const list = reviews ?? [];
  const average = list.length
    ? Math.round((list.reduce((sum, r) => sum + r.rating, 0) / list.length) * 10) / 10
    : 0;

  // Google only accepts AggregateRating backed by reviews actually on the page.
  const aggregateLd = list.length
    ? {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        "@id": `${SITE_URL}/#restaurant`,
        name: SITE,
        image: absolute("/og-image.png"),
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: average,
          reviewCount: list.length,
          bestRating: 5,
          worstRating: 1,
        },
        review: list.slice(0, 20).map((r) => ({
          "@type": "Review",
          author: { "@type": "Person", name: r.author_name },
          datePublished: r.created_at.slice(0, 10),
          reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
          ...(r.body ? { reviewBody: r.body } : {}),
        })),
      }
    : null;

  return (
    <PageShell>
      {aggregateLd && (
        <script
          type="application/ld+json"
          // The payload is our own data, serialised by us — not user-controlled HTML.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(aggregateLd) }}
        />
      )}

      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="lab-label text-primary">Verified reviews</p>
        <h1 className="mt-1 text-4xl font-black sm:text-5xl">What people say</h1>

        {list.length > 0 && (
          <div className="lab-card mt-6 flex flex-wrap items-center gap-4 p-5">
            <p className="font-display text-5xl font-black">{average.toFixed(1)}</p>
            <div>
              <Stars rating={Math.round(average)} className="size-5" />
              <p className="mt-1 text-sm text-muted-foreground">
                {list.length} verified review{list.length === 1 ? "" : "s"} — every one from a real
                order.
              </p>
            </div>
          </div>
        )}

        {isLoading && <p className="mt-6 text-muted-foreground">Loading reviews…</p>}

        {!isLoading && list.length === 0 && (
          <div className="lab-card mt-6 p-6 text-center">
            <p className="text-muted-foreground">
              No reviews published yet — be the first to try us.
            </p>
            <Button asChild variant="lab" size="xl" className="mt-4">
              <Link to="/menu">Build a plate</Link>
            </Button>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {list.map((review) => (
            <article key={review.id} className="lab-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Stars rating={review.rating} />
                <p className="text-sm text-muted-foreground">
                  {review.author_name} ·{" "}
                  <time dateTime={review.created_at}>
                    {new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(
                      new Date(review.created_at),
                    )}
                  </time>
                </p>
              </div>
              {review.body && <p className="mt-3">{review.body}</p>}
            </article>
          ))}
        </div>

        {list.length > 0 && (
          <div className="mt-8 text-center">
            <Button asChild variant="lab" size="xl">
              <Link to="/menu">Order yours</Link>
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
