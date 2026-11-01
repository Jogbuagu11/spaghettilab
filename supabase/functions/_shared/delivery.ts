import type { Catalog } from "./catalog.ts";
import { distanceMiles, geocode } from "./geo.ts";
import { PublicError } from "./http.ts";
import type { DeliveryDetails } from "./place-order.ts";

/**
 * Geocodes an address and refuses it if it falls outside the delivery radius.
 * Shared by checkout and subscription signup so the radius can't drift between
 * the two paths.
 */
export async function checkDeliveryAddress(
  catalog: Catalog,
  rawAddress: string,
): Promise<DeliveryDetails> {
  const geo = await geocode(rawAddress);
  const miles = distanceMiles(
    catalog.settings.origin_lat,
    catalog.settings.origin_lng,
    geo.lat,
    geo.lng,
  );

  if (miles > catalog.settings.delivery_radius_miles) {
    throw new PublicError(
      `Sorry — that address is ${miles.toFixed(1)} miles away and we only deliver within ` +
        `${catalog.settings.delivery_radius_miles} miles of ${catalog.settings.origin_postal_code}. ` +
        `Pickup is still available.`,
    );
  }

  return {
    address: geo.formatted,
    lat: geo.lat,
    lng: geo.lng,
    distanceMi: Number(miles.toFixed(2)),
  };
}
