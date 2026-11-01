/**
 * Regenerates every favicon, app icon and social-share image from the single
 * source logo. Run after replacing `brand/logo-source.png`:
 *
 *   npx --yes --package=sharp -c "node scripts/generate-brand-assets.mjs"
 *
 * sharp is intentionally NOT a package.json dependency — this is a one-off
 * authoring tool and the generated files are committed to the repo.
 */
import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "brand", "logo-source.png");
const PUBLIC = path.join(ROOT, "public");

// Brand palette, converted from the oklch tokens in src/styles.css.
const CREAM = "#FCF6E9";
const INK = "#2C1A15";
const TOMATO = "#D7371D";
const BASIL = "#357A3A";

/**
 * The source art sits on an opaque white card. Chroma-keying every white pixel
 * would also punch holes in the plate, so instead flood fill inwards from the
 * border: that only reaches white connected to the outside edge and stops at
 * the plate's dark red rim.
 */
async function cutOutBackground() {
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels: ch } = info;
  const isBg = (i) => data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244;
  const seen = new Uint8Array(w * h);
  const queue = [];

  for (let x = 0; x < w; x++) {
    queue.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    queue.push(y * w, y * w + (w - 1));
  }

  while (queue.length) {
    const p = queue.pop();
    if (seen[p]) continue;
    const i = p * ch;
    if (!isBg(i)) continue;
    seen[p] = 1;
    data[i + 3] = 0;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) queue.push(p - 1);
    if (x < w - 1) queue.push(p + 1);
    if (y > 0) queue.push(p - w);
    if (y < h - 1) queue.push(p + w);
  }

  // Feather the hard edge the flood fill leaves behind so downscaled icons
  // don't get a white fringe.
  return sharp(data, { raw: { width: w, height: h, channels: ch } })
    .png()
    .toBuffer()
    .then((buf) => sharp(buf).trim({ threshold: 0 }).png().toBuffer());
}

async function resized(logoBuf, px) {
  return sharp(logoBuf)
    .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Minimal ICO writer. Each entry stores a complete PNG, which every browser since IE11 reads. */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  let offset = 6 + pngs.length * 16;
  const entries = [];
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Social share card. Mirrors the site's design language: cream ground, heavy
 * ink outline, hard offset shadow.
 */
function ogSvg(width, height, logoDataUri, { title, tagline, pill, logoSize, stacked }) {
  const pad = Math.round(width * 0.045);
  const frame = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 };
  const shadow = Math.round(width * 0.011);

  // Georgia bold averages ~0.52em per character; size the wordmark so it always
  // clears the frame's inner edge rather than trusting a fixed font size.
  const textX = frame.x + width * 0.045 + logoSize;
  const available = frame.x + frame.w - textX - width * 0.03;
  const titleSize = Math.min(width * 0.082, available / (title.length * 0.52));
  const pillFont = width * 0.0225;
  const pillWidth = Math.min(available, pill.length * pillFont * 0.62 + width * 0.038);

  const layout = stacked
    ? `
      <image href="${logoDataUri}" x="${(width - logoSize) / 2}" y="${frame.y + height * 0.1}" width="${logoSize}" height="${logoSize}" />
      <g text-anchor="middle">
        <text x="${width / 2}" y="${frame.y + height * 0.1 + logoSize + height * 0.11}" font-family="Georgia, 'Times New Roman', serif" font-weight="bold" font-size="${width * 0.105}" fill="${INK}" letter-spacing="-2">${esc(title)}</text>
        <text x="${width / 2}" y="${frame.y + height * 0.1 + logoSize + height * 0.175}" font-family="Helvetica, Arial, sans-serif" font-size="${width * 0.038}" fill="${INK}" opacity="0.72">${esc(tagline)}</text>
      </g>`
    : `
      <image href="${logoDataUri}" x="${frame.x + width * 0.025}" y="${(height - logoSize) / 2}" width="${logoSize}" height="${logoSize}" />
      <g>
        <text x="${textX}" y="${height * 0.42}" font-family="Georgia, 'Times New Roman', serif" font-weight="bold" font-size="${titleSize}" fill="${INK}" letter-spacing="-2">${esc(title)}</text>
        <text x="${textX}" y="${height * 0.545}" font-family="Helvetica, Arial, sans-serif" font-size="${width * 0.029}" fill="${INK}" opacity="0.72">${esc(tagline)}</text>
        <g transform="translate(${textX}, ${height * 0.615})">
          <rect x="0" y="0" rx="${height * 0.048}" width="${pillWidth}" height="${height * 0.095}" fill="${TOMATO}" />
          <text x="${width * 0.019}" y="${height * 0.0632}" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${pillFont}" fill="#FFFFFF" letter-spacing="0.4">${esc(pill)}</text>
        </g>
      </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${CREAM}" />
    <circle cx="${width * 0.93}" cy="${height * 0.12}" r="${width * 0.16}" fill="${BASIL}" opacity="0.13" />
    <circle cx="${width * 0.06}" cy="${height * 0.95}" r="${width * 0.14}" fill="${TOMATO}" opacity="0.12" />
    <rect x="${frame.x + shadow}" y="${frame.y + shadow}" width="${frame.w}" height="${frame.h}" rx="${width * 0.022}" fill="${INK}" />
    <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" rx="${width * 0.022}" fill="${CREAM}" stroke="${INK}" stroke-width="${Math.max(3, width * 0.004)}" />
    ${layout}
  </svg>`;
}

async function main() {
  await mkdir(PUBLIC, { recursive: true });
  await mkdir(path.join(ROOT, "src", "assets"), { recursive: true });

  const logo = await cutOutBackground();
  const write = async (rel, buf) => {
    await writeFile(path.join(ROOT, rel), buf);
    console.log(`  ${rel}  ${(buf.length / 1024).toFixed(1)} kB`);
  };

  console.log("transparent logo");
  await write("public/logo.png", await resized(logo, 512));
  await write("src/assets/logo.png", await resized(logo, 512));
  await write("public/logo-1024.png", await resized(logo, 1024));

  console.log("favicons");
  const icoSizes = [16, 32, 48];
  const icoPngs = [];
  for (const size of icoSizes) icoPngs.push({ size, data: await resized(logo, size) });
  await write("public/favicon.ico", buildIco(icoPngs));
  await write("public/favicon-96x96.png", await resized(logo, 96));

  console.log("app icons");
  const onCream = async (size, pad) => {
    const inner = Math.round(size * (1 - pad * 2));
    return sharp({ create: { width: size, height: size, channels: 4, background: CREAM } })
      .composite([
        {
          input: await resized(logo, inner),
          top: Math.round((size - inner) / 2),
          left: Math.round((size - inner) / 2),
        },
      ])
      .png()
      .toBuffer();
  };
  await write("public/apple-touch-icon.png", await onCream(180, 0.08));
  await write("public/icon-192.png", await onCream(192, 0.06));
  await write("public/icon-512.png", await onCream(512, 0.06));
  // Maskable icons get cropped to a circle on Android: keep art inside the 80% safe zone.
  await write("public/icon-maskable-512.png", await onCream(512, 0.18));

  console.log("social cards");
  const logoDataUri = `data:image/png;base64,${(await resized(logo, 1024)).toString("base64")}`;
  const cards = [
    { file: "public/og-image.png", w: 1200, h: 630, logoSize: 430, stacked: false },
    { file: "public/og-image-square.png", w: 1080, h: 1080, logoSize: 560, stacked: true },
  ];
  for (const c of cards) {
    const svg = ogSvg(c.w, c.h, logoDataUri, {
      title: "Spaghetti Lab",
      tagline: "Fresh spaghetti, built your way.",
      pill: "PICKUP & DELIVERY · SAN JOSE",
      logoSize: c.logoSize,
      stacked: c.stacked,
    });
    await write(c.file, await sharp(Buffer.from(svg)).png().toBuffer());
  }

  console.log("\ndone");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
