#!/usr/bin/env node
/**
 * Generates the ordering Flow from the live menu and publishes it to WhatsApp.
 *
 *   node scripts/whatsapp-flow-publish.mjs --dry-run   # print the Flow JSON
 *   node scripts/whatsapp-flow-publish.mjs             # create or update
 *
 * The Flow has no data endpoint: the menu is baked into the JSON, which avoids
 * implementing Meta's encrypted endpoint for what is a small, slow-moving
 * menu. Re-run this after changing prices or sold-out flags in /admin — the
 * labels would otherwise go stale. Prices shown in chat are cosmetic; the
 * order is always re-priced server-side when the Flow is submitted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const GRAPH = "https://graph.facebook.com/v21.0";
const FLOW_JSON_VERSION = "7.3";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(path.join(ROOT, file), "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* optional */
    }
  }
}
loadEnv();

const need = (n) => {
  if (!process.env[n]) {
    console.error(`\n  Missing ${n}. Add it to .env.local.\n`);
    process.exit(1);
  }
  return process.env[n];
};

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

// --------------------------------------------------------------- menu ----

async function loadMenu() {
  const url = need("SUPABASE_URL");
  const key = need("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(
    `${url}/rest/v1/menu_options?select=id,group_name,label,price_cents,is_available&order=group_name,sort_order`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  // Sold-out options simply don't appear, so nobody can order them.
  return (await res.json()).filter((o) => o.is_available);
}

const asOptions = (rows, withPrice = true) =>
  rows.map((r) => ({
    id: r.id,
    title: withPrice && r.price_cents > 0 ? `${r.label} (+${money(r.price_cents)})` : r.label,
  }));

// --------------------------------------------------------------- flow ----

function buildFlow(menu) {
  const group = (g) => menu.filter((o) => o.group_name === g);
  const sizes = group("size").map((s) => ({
    id: s.id,
    title: `${s.label} — ${money(s.price_cents)}`,
  }));

  return {
    version: FLOW_JSON_VERSION,
    screens: [
      {
        id: "PLATE",
        title: "Build your plate",
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "plate",
              children: [
                {
                  type: "RadioButtonsGroup",
                  name: "size",
                  label: "Size",
                  required: true,
                  "data-source": sizes,
                },
                {
                  // Flows can't repeat a section, so a single plate config with
                  // a quantity is the most a chat order can express. Anyone
                  // wanting two different plates is pointed at the website.
                  type: "Dropdown",
                  name: "quantity",
                  label: "How many of this plate?",
                  required: true,
                  "data-source": Array.from({ length: 10 }, (_, i) => ({
                    id: String(i + 1),
                    title: `${i + 1}`,
                  })),
                },
                {
                  type: "RadioButtonsGroup",
                  name: "heat",
                  label: "Heat",
                  required: true,
                  "data-source": asOptions(group("heat"), false),
                },
                {
                  type: "CheckboxGroup",
                  name: "proteins",
                  label: "Protein",
                  required: false,
                  "data-source": asOptions(group("protein")),
                },
                {
                  type: "CheckboxGroup",
                  name: "customizations",
                  label: "Add-ons",
                  required: false,
                  "data-source": asOptions(group("customization")),
                },
                {
                  type: "CheckboxGroup",
                  name: "extras",
                  label: "Sides & drinks",
                  required: false,
                  "data-source": asOptions(group("extra")),
                },
                {
                  type: "Footer",
                  label: "Continue",
                  "on-click-action": {
                    name: "navigate",
                    next: { type: "screen", name: "WHEN" },
                    payload: {
                      size: "${form.size}",
                      quantity: "${form.quantity}",
                      heat: "${form.heat}",
                      proteins: "${form.proteins}",
                      customizations: "${form.customizations}",
                      extras: "${form.extras}",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      {
        id: "WHEN",
        title: "Pickup or delivery",
        data: {
          size: { type: "string", __example__: "medium" },
          quantity: { type: "string", __example__: "1" },
          heat: { type: "string", __example__: "mild" },
          proteins: { type: "array", items: { type: "string" }, __example__: [] },
          customizations: { type: "array", items: { type: "string" }, __example__: [] },
          extras: { type: "array", items: { type: "string" }, __example__: [] },
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "when_form",
              children: [
                {
                  type: "RadioButtonsGroup",
                  name: "fulfillment",
                  label: "How would you like it?",
                  required: true,
                  "data-source": [
                    { id: "pickup", title: "Pickup — Berryessa" },
                    { id: "delivery", title: "Delivery — within 5 miles" },
                  ],
                },
                {
                  type: "TextInput",
                  name: "address",
                  label: "Delivery address",
                  "helper-text": "Only needed for delivery",
                  required: false,
                },
                {
                  type: "TextInput",
                  name: "note",
                  label: "Notes for the kitchen",
                  required: false,
                },
                {
                  type: "Footer",
                  label: "Continue",
                  "on-click-action": {
                    name: "navigate",
                    next: { type: "screen", name: "DETAILS" },
                    payload: {
                      size: "${data.size}",
                      quantity: "${data.quantity}",
                      heat: "${data.heat}",
                      proteins: "${data.proteins}",
                      customizations: "${data.customizations}",
                      extras: "${data.extras}",
                      fulfillment: "${form.fulfillment}",
                      address: "${form.address}",
                      note: "${form.note}",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
      {
        id: "DETAILS",
        title: "Your details",
        terminal: true,
        data: {
          size: { type: "string", __example__: "medium" },
          quantity: { type: "string", __example__: "1" },
          heat: { type: "string", __example__: "mild" },
          proteins: { type: "array", items: { type: "string" }, __example__: [] },
          customizations: { type: "array", items: { type: "string" }, __example__: [] },
          extras: { type: "array", items: { type: "string" }, __example__: [] },
          fulfillment: { type: "string", __example__: "pickup" },
          address: { type: "string", __example__: "" },
          note: { type: "string", __example__: "" },
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            {
              type: "Form",
              name: "details",
              children: [
                { type: "TextInput", name: "name", label: "Name", required: true },
                {
                  type: "TextInput",
                  name: "email",
                  label: "Email",
                  "input-type": "email",
                  "helper-text": "For your receipt and order updates",
                  required: true,
                },
                {
                  type: "TextInput",
                  name: "phone",
                  label: "Phone",
                  "input-type": "phone",
                  required: true,
                },
                {
                  type: "TextBody",
                  text: "We'll send a secure payment link next. Nothing is charged until you pay.",
                },
                {
                  type: "Footer",
                  label: "Place order",
                  "on-click-action": {
                    name: "complete",
                    payload: {
                      size: "${data.size}",
                      quantity: "${data.quantity}",
                      heat: "${data.heat}",
                      proteins: "${data.proteins}",
                      customizations: "${data.customizations}",
                      extras: "${data.extras}",
                      fulfillment: "${data.fulfillment}",
                      address: "${data.address}",
                      note: "${data.note}",
                      name: "${form.name}",
                      email: "${form.email}",
                      phone: "${form.phone}",
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

// -------------------------------------------------------------- publish ----

async function graph(pathname, init = {}) {
  const res = await fetch(`${GRAPH}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${need("WHATSAPP_ACCESS_TOKEN")}`, ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph ${res.status}: ${JSON.stringify(body.error ?? body)}`);
  return body;
}

async function main() {
  const menu = await loadMenu();
  const flow = buildFlow(menu);

  if (DRY_RUN) {
    console.log(JSON.stringify(flow, null, 2));
    console.log(`\n  --dry-run: nothing published. ${flow.screens.length} screens.\n`);
    return;
  }

  const waba = need("WHATSAPP_BUSINESS_ACCOUNT_ID");
  let flowId = process.env.WHATSAPP_FLOW_ID;

  if (!flowId) {
    const created = await graph(`/${waba}/flows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Spaghetti Lab order", categories: ["OTHER"] }),
    });
    flowId = created.id;
    console.log(`\n  created flow ${flowId} — add WHATSAPP_FLOW_ID=${flowId} to .env.local`);
  }

  // The JSON is uploaded as a file part, not as a JSON body.
  const form = new FormData();
  form.set("name", "flow.json");
  form.set("asset_type", "FLOW_JSON");
  form.set("file", new Blob([JSON.stringify(flow)], { type: "application/json" }), "flow.json");

  const upload = await graph(`/${flowId}/assets`, { method: "POST", body: form });
  const errors = upload.validation_errors ?? [];
  if (errors.length) {
    console.error("\n  validation errors:");
    for (const e of errors) console.error(`    ${e.error}: ${e.message}`);
    process.exit(1);
  }
  console.log("  uploaded flow JSON");

  await graph(`/${flowId}/publish`, { method: "POST" });
  console.log(`  published\n\n  Flow id: ${flowId}\n`);
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
});
