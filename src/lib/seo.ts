import { DAYS_LD } from "./seo-data";

export const SITE = "Spaghetti Lab";

/**
 * Canonical origin. Crawlers and social scrapers reject relative URLs in
 * og:url / og:image, so every tag below is absolutised against this.
 */
export const SITE_URL = (
  (import.meta.env["VITE_SITE_URL"] as string | undefined) ?? "https://spaghettilab.store"
).replace(/\/$/, "");

export const absolute = (path: string) => (path.startsWith("http") ? path : `${SITE_URL}${path}`);

export const OG_IMAGE = absolute("/og-image.png");
export const OG_IMAGE_SQUARE = absolute("/og-image-square.png");

export interface PageMetaOptions {
  /** Defaults to the wide share card. */
  image?: string;
  /** "website" for most pages, "article" for posts. */
  type?: string;
}

export function pageMeta(
  title: string,
  description: string,
  path: string,
  options: PageMetaOptions = {},
) {
  const url = absolute(path);
  const image = absolute(options.image ?? OG_IMAGE);

  return {
    meta: [
      { title },
      { name: "description", content: description },

      // Open Graph — Facebook, LinkedIn, iMessage, WhatsApp, Slack.
      { property: "og:site_name", content: SITE },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: options.type ?? "website" },
      { property: "og:url", content: url },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: `${SITE} — fresh spaghetti, built your way` },
      { property: "og:locale", content: "en_US" },

      // Twitter/X reads its own namespace rather than falling back to OG.
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: `${SITE} — fresh spaghetti, built your way` },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

export const restaurantLd = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "@id": `${SITE_URL}/#restaurant`,
  name: SITE,
  url: SITE_URL,
  image: OG_IMAGE,
  logo: absolute("/logo.png"),
  description:
    "Fresh spaghetti plates built to order — pickup and delivery in Berryessa, North San Jose.",
  servesCuisine: "Italian-American",
  priceRange: "$$",
  currenciesAccepted: "USD",
  paymentAccepted: "Credit Card, Apple Pay, Google Pay",
  address: {
    "@type": "PostalAddress",
    addressLocality: "San Jose",
    addressRegion: "CA",
    postalCode: "95131",
    addressCountry: "US",
  },
  areaServed: {
    "@type": "GeoCircle",
    geoMidpoint: { "@type": "GeoCoordinates", latitude: 37.3858, longitude: -121.8615 },
    geoRadius: "8047",
  },
  openingHoursSpecification: [
    { "@type": "OpeningHoursSpecification", dayOfWeek: DAYS_LD, opens: "12:00", closes: "20:00" },
  ],
  hasMenu: absolute("/menu"),
  acceptsReservations: false,
  potentialAction: {
    "@type": "OrderAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: absolute("/menu"),
      actionPlatform: [
        "http://schema.org/DesktopWebPlatform",
        "http://schema.org/MobileWebPlatform",
      ],
    },
    deliveryMethod: [
      "http://purl.org/goodrelations/v1#DeliveryModePickUp",
      "http://purl.org/goodrelations/v1#DeliveryModeOwnFleet",
    ],
  },
};

/** Site-wide organisation node; `sameAs` is filled from admin-managed socials. */
export function organizationLd(socials: Array<string | null | undefined>) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE,
    url: SITE_URL,
    logo: absolute("/logo.png"),
    sameAs: socials.filter((s): s is string => Boolean(s)),
  };
}
