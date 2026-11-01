import { useEffect } from "react";
import { useStorefront } from "@/lib/storefront";

/**
 * Injects GA4 and the Meta Pixel when the owner has set their IDs in the admin
 * dashboard. Nothing loads otherwise, so a fresh install ships no third-party
 * trackers at all.
 *
 * Client-side only: these tags need `window`, and keeping them out of SSR
 * avoids blocking the first paint on third-party requests.
 */
export function Analytics() {
  const { settings } = useStorefront();
  const ga4 = settings.ga4MeasurementId;
  const pixel = settings.metaPixelId;

  useEffect(() => {
    if (!ga4 || document.getElementById("ga4-src")) return;

    const script = document.createElement("script");
    script.id = "ga4-src";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`;
    document.head.appendChild(script);

    const inline = document.createElement("script");
    inline.id = "ga4-init";
    inline.textContent =
      `window.dataLayer=window.dataLayer||[];` +
      `function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());` +
      `gtag('config',${JSON.stringify(ga4)});`;
    document.head.appendChild(inline);
  }, [ga4]);

  useEffect(() => {
    if (!pixel || document.getElementById("meta-pixel")) return;

    const inline = document.createElement("script");
    inline.id = "meta-pixel";
    inline.textContent =
      `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
      `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
      `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
      `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
      `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
      `fbq('init',${JSON.stringify(pixel)});fbq('track','PageView');`;
    document.head.appendChild(inline);
  }, [pixel]);

  return null;
}
