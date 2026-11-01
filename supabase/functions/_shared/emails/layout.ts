import { SITE_URL } from "../env.ts";

/**
 * Brand palette, converted from the oklch tokens in src/styles.css. Email
 * clients don't understand oklch, custom properties or @import, so everything
 * here is literal hex and inline styles.
 */
export const BRAND = {
  cream: "#FCF6E9",
  card: "#FFFDF7",
  ink: "#2C1A15",
  tomato: "#D7371D",
  basil: "#357A3A",
  muted: "#F3EAD9",
  mutedText: "#6D5851",
  border: "#E3D5C2",
  gold: "#E7B643",
} as const;

const DISPLAY = "Georgia, 'Times New Roman', Times, serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface LayoutOptions {
  /** Inbox preview line. Without it clients scrape the first body text. */
  preheader: string;
  heading: string;
  /** Small uppercase line above the heading, e.g. "ORDER SL-1042". */
  eyebrow?: string;
  body: string;
  cta?: { label: string; url: string };
  footerNote?: string;
}

export function button(label: string, url: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
    <tr>
      <td align="center" bgcolor="${BRAND.tomato}" style="border-radius:999px;border:2px solid ${BRAND.ink};">
        <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** Bordered panel matching the site's `lab-card` utility. */
export function card(inner: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;border:2px solid ${BRAND.ink};border-radius:14px;background:${BRAND.card};">
    <tr><td style="padding:20px 22px;">${inner}</td></tr>
  </table>`;
}

export function label(text: string): string {
  return `<p style="margin:0 0 6px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:${BRAND.mutedText};">${escapeHtml(text)}</p>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:1.6;color:${BRAND.ink};">${html}</p>`;
}

/**
 * Wraps content in the branded shell. Table-based and inline-styled because
 * Gmail strips <style> blocks and Outlook ignores most modern CSS.
 */
export function renderEmail(opts: LayoutOptions): string {
  const social = `<a href="${SITE_URL}" style="color:${BRAND.mutedText};text-decoration:underline;">spaghettilab.store</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};-webkit-font-smoothing:antialiased;">
  <div style="display:none;font-size:1px;color:${BRAND.cream};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:28px 14px 40px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

          <tr>
            <td align="center" style="padding:8px 0 22px;">
              <a href="${SITE_URL}" style="text-decoration:none;">
                <img src="${SITE_URL}/logo.png" width="76" height="76" alt="Spaghetti Lab" style="display:block;margin:0 auto 10px;border:0;">
                <span style="font-family:${DISPLAY};font-size:26px;font-weight:bold;color:${BRAND.ink};letter-spacing:-0.5px;">Spaghetti Lab</span>
              </a>
            </td>
          </tr>

          <tr>
            <td style="background:${BRAND.card};border:2px solid ${BRAND.ink};border-radius:18px;padding:34px 30px;">
              ${opts.eyebrow ? `<p style="margin:0 0 10px;font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:1.6px;text-transform:uppercase;color:${BRAND.tomato};">${escapeHtml(opts.eyebrow)}</p>` : ""}
              <h1 style="margin:0 0 18px;font-family:${DISPLAY};font-size:30px;line-height:1.2;font-weight:bold;color:${BRAND.ink};letter-spacing:-0.6px;">${escapeHtml(opts.heading)}</h1>
              ${opts.body}
              ${opts.cta ? button(opts.cta.label, opts.cta.url) : ""}
            </td>
          </tr>

          <tr>
            <td style="padding:24px 18px 0;text-align:center;">
              ${opts.footerNote ? `<p style="margin:0 0 14px;font-family:${SANS};font-size:13px;line-height:1.6;color:${BRAND.mutedText};">${opts.footerNote}</p>` : ""}
              <p style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.7;color:${BRAND.mutedText};">
                Spaghetti Lab · Permitted MEHKO, Santa Clara County<br>
                Berryessa, San Jose, CA 95131 · ${social}
              </p>
              <p style="margin:10px 0 0;font-family:${SANS};font-size:11px;color:${BRAND.mutedText};">
                This message was sent about your order. Replies go to a monitored inbox.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Strips tags for the text/plain alternative — spam filters penalise its absence. */
export function toPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|h1|h2|div|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}
