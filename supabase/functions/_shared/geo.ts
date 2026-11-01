import { PublicError } from "./http.ts";

export interface GeocodeResult {
  lat: number;
  lng: number;
  formatted: string;
}

/**
 * Geocodes a US street address. Prefers Google when a key is configured;
 * otherwise falls back to the US Census geocoder, which is free, keyless and
 * accurate for domestic street addresses.
 */
export async function geocode(address: string): Promise<GeocodeResult> {
  const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const result = googleKey ? await geocodeGoogle(address, googleKey) : await geocodeCensus(address);
  if (!result) {
    throw new PublicError("We couldn't find that address — please check it and try again.");
  }
  return result;
}

async function geocodeGoogle(address: string, key: string): Promise<GeocodeResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("components", "country:US");
  url.searchParams.set("key", key);

  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  const hit = body?.results?.[0];
  if (!hit?.geometry?.location) return null;

  return {
    lat: hit.geometry.location.lat,
    lng: hit.geometry.location.lng,
    formatted: hit.formatted_address ?? address,
  };
}

async function geocodeCensus(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const body = await res.json();
  const hit = body?.result?.addressMatches?.[0];
  if (!hit?.coordinates) return null;

  return {
    lat: hit.coordinates.y,
    lng: hit.coordinates.x,
    formatted: hit.matchedAddress ?? address,
  };
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles. */
export function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
