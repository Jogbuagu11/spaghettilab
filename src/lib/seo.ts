import { DAYS_LD } from "./seo-data";

export const SITE = "Spaghetti Lab";

export function pageMeta(title: string, description: string, path: string) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: path },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: [{ rel: "canonical", href: path }],
  };
}

export const restaurantLd = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: SITE,
  servesCuisine: "Italian-American",
  priceRange: "$$",
  address: { "@type": "PostalAddress", addressLocality: "San Jose", addressRegion: "CA", postalCode: "95131", addressCountry: "US" },
  areaServed: { "@type": "GeoCircle", geoMidpoint: { "@type": "GeoCoordinates", postalCode: "95131" }, geoRadius: "8047" },
  openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: DAYS_LD, opens: "12:00", closes: "20:00" }],
  hasMenu: "/menu",
  acceptsReservations: false,
};
