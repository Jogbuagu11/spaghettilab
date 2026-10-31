import { EXTRAS, SIZES } from "./menu";

export const DAYS_LD = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const menuLd = {
  "@context": "https://schema.org",
  "@type": "Menu",
  name: "Spaghetti Lab Menu",
  hasMenuSection: [
    {
      "@type": "MenuSection",
      name: "Spaghetti Plates",
      hasMenuItem: SIZES.map((s) => ({
        "@type": "MenuItem",
        name: `${s.label} Spaghetti Plate`,
        description: "Fresh spaghetti, spicy or not spicy, with optional meatball, sausage or minced pork.",
        offers: { "@type": "Offer", price: (s.price / 100).toFixed(2), priceCurrency: "USD" },
      })),
    },
    {
      "@type": "MenuSection",
      name: "Sides & Drinks",
      hasMenuItem: EXTRAS.map((e) => ({
        "@type": "MenuItem",
        name: e.label,
        offers: { "@type": "Offer", price: (e.price / 100).toFixed(2), priceCurrency: "USD" },
      })),
    },
  ],
};
