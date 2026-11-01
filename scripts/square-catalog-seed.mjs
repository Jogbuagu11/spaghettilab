#!/usr/bin/env node
/**
 * Pushes the Supabase menu into the Square catalog.
 *
 * Square retired its CLI (the `square-cli` npm package was unpublished in
 * January 2026 and the docs page is gone), so this script talks to the Catalog
 * API directly — same result, no dead dependency.
 *
 *   node scripts/square-catalog-seed.mjs            # create or update
 *   node scripts/square-catalog-seed.mjs --dry-run  # print the payload only
 *
 * Re-running is safe: Square object ids are written back to menu_options, and
 * subsequent runs update those objects in place rather than duplicating them.
 *
 * Reads credentials from the environment or .env.local.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");
const SQUARE_VERSION = "2025-09-24";

// ------------------------------------------------------------------ env ----

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(path.join(ROOT, file), "utf8").split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue; // real env wins
        process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* file is optional */
    }
  }
}

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  Missing ${name}. Add it to .env.local or export it.\n`);
    process.exit(1);
  }
  return value;
}

loadEnv();

const SUPABASE_URL = need("SUPABASE_URL");
const SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY");
const SQUARE_TOKEN = need("SQUARE_ACCESS_TOKEN");
const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT ?? "sandbox";
const SQUARE_BASE =
  SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

// -------------------------------------------------------------- clients ----

async function supabase(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function square(pathname, init = {}) {
  const res = await fetch(`${SQUARE_BASE}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${SQUARE_TOKEN}`,
      "square-version": SQUARE_VERSION,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Square ${res.status}: ${JSON.stringify(body.errors ?? body, null, 2)}`);
  }
  return body;
}

// --------------------------------------------------------------- shapes ----

const money = (cents) => ({ amount: cents, currency: "USD" });

/** Square rejects '#' and most punctuation in temp ids. */
const tempId = (...parts) => `#${parts.join("-").replace(/[^A-Za-z0-9_-]/g, "")}`;

function modifier(option, listTempId) {
  return {
    type: "MODIFIER",
    id: tempId("mod", option.id),
    present_at_all_locations: true,
    modifier_data: {
      name: option.label,
      price_money: money(option.price_cents),
      modifier_list_id: listTempId,
      on_by_default: false,
    },
  };
}

function modifierList({ key, name, selectionType, options, allowQuantity = false }) {
  const listId = tempId("list", key);
  return {
    type: "MODIFIER_LIST",
    id: listId,
    present_at_all_locations: true,
    modifier_list_data: {
      name,
      selection_type: selectionType,
      modifiers: options.map((o) => modifier(o, listId)),
      ...(allowQuantity ? { allow_quantity: true } : {}),
    },
  };
}

/**
 * The plate builder is one item with size variations plus three modifier
 * lists — that way Square receipts and sales reports break down by size and
 * topping instead of showing a single opaque "Order" line.
 */
function plateItem(sizes, listIds) {
  return {
    type: "ITEM",
    id: tempId("item", "spaghetti-plate"),
    present_at_all_locations: true,
    item_data: {
      name: "Spaghetti Plate",
      description: "Fresh spaghetti, spicy or not, built to order.",
      product_type: "FOOD_AND_BEV",
      modifier_list_info: listIds.map((id, index) => ({
        modifier_list_id: id,
        enabled: true,
        ordinal: index,
      })),
      variations: sizes.map((size, index) => ({
        type: "ITEM_VARIATION",
        id: tempId("var", size.id),
        present_at_all_locations: true,
        item_variation_data: {
          name: size.label,
          pricing_type: "FIXED_PRICING",
          price_money: money(size.price_cents),
          ordinal: index,
        },
      })),
    },
  };
}

function extraItem(extra) {
  return {
    type: "ITEM",
    id: tempId("item", extra.id),
    present_at_all_locations: true,
    item_data: {
      name: extra.label,
      product_type: "FOOD_AND_BEV",
      variations: [
        {
          type: "ITEM_VARIATION",
          id: tempId("var", extra.id),
          present_at_all_locations: true,
          item_variation_data: {
            name: "Regular",
            pricing_type: "FIXED_PRICING",
            price_money: money(extra.price_cents),
          },
        },
      ],
    },
  };
}

// ----------------------------------------------------------------- main ----

/**
 * Square needs the current `version` of an object to update it. Anything we
 * previously created is fetched so the upsert replaces it instead of failing.
 */
async function existingVersions(ids) {
  if (ids.length === 0) return new Map();
  const { objects = [] } = await square("/v2/catalog/batch-retrieve", {
    method: "POST",
    body: JSON.stringify({ object_ids: ids, include_related_objects: false }),
  });
  const versions = new Map();
  const walk = (obj) => {
    versions.set(obj.id, obj.version);
    for (const child of obj.item_data?.variations ?? []) walk(child);
    for (const child of obj.modifier_list_data?.modifiers ?? []) walk(child);
  };
  objects.forEach(walk);
  return versions;
}

/** Swaps temp ids for real ones where we already know them, and attaches versions. */
function applyExisting(object, idMap, versions) {
  const known = idMap.get(object.id);
  if (known && versions.has(known)) {
    object.id = known;
    object.version = versions.get(known);
  }
  for (const child of object.item_data?.variations ?? []) applyExisting(child, idMap, versions);
  for (const child of object.modifier_list_data?.modifiers ?? [])
    applyExisting(child, idMap, versions);
  return object;
}

async function main() {
  console.log(`\n  Square catalog sync — ${SQUARE_ENV}\n`);

  const options = await supabase(
    "menu_options?select=id,group_name,label,price_cents,sort_order,square_object_id,square_variation_id&order=group_name,sort_order",
  );
  const byGroup = (group) => options.filter((o) => o.group_name === group);

  const sizes = byGroup("size");
  if (sizes.length === 0) throw new Error("No sizes in menu_options — run the migrations first.");

  const heatList = modifierList({
    key: "heat",
    name: "Heat",
    selectionType: "SINGLE",
    options: byGroup("heat"),
  });
  const proteinList = modifierList({
    key: "protein",
    name: "Proteins",
    selectionType: "MULTIPLE",
    options: byGroup("protein"),
    allowQuantity: true,
  });
  const customList = modifierList({
    key: "customization",
    name: "Add-ons",
    selectionType: "MULTIPLE",
    options: byGroup("customization"),
  });

  const objects = [
    heatList,
    proteinList,
    customList,
    plateItem(sizes, [heatList.id, proteinList.id, customList.id]),
    ...byGroup("extra").map(extraItem),
  ];

  if (DRY_RUN) {
    console.log(JSON.stringify(objects, null, 2));
    console.log(`\n  --dry-run: nothing sent. ${objects.length} top-level objects.\n`);
    return;
  }

  // Map our temp ids back to any Square ids we stored on a previous run.
  const idMap = new Map();
  for (const option of options) {
    if (option.square_object_id) idMap.set(tempId("mod", option.id), option.square_object_id);
    if (option.square_variation_id) idMap.set(tempId("var", option.id), option.square_variation_id);
  }
  const versions = await existingVersions([...new Set(idMap.values())]);
  objects.forEach((object) => applyExisting(object, idMap, versions));

  const response = await square("/v2/catalog/batch-upsert", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `spaghetti-lab-${new Date().toISOString().slice(0, 16)}`,
      batches: [{ objects }],
    }),
  });

  // Square returns the temp-id -> permanent-id mapping for newly created rows.
  const mapped = new Map(
    (response.id_mappings ?? []).map((m) => [m.client_object_id, m.object_id]),
  );
  const resolve = (temp) => mapped.get(temp) ?? idMap.get(temp) ?? null;

  const updates = [];
  for (const option of options) {
    const objectId = resolve(tempId("mod", option.id));
    const variationId = resolve(tempId("var", option.id));
    if (!objectId && !variationId) continue;
    updates.push({
      id: option.id,
      square_object_id: objectId ?? option.square_object_id,
      square_variation_id: variationId ?? option.square_variation_id,
    });
  }

  for (const update of updates) {
    const { id, ...patch } = update;
    await supabase(`menu_options?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
      headers: { prefer: "return=minimal" },
    });
  }

  console.log(`  upserted ${response.objects?.length ?? 0} catalog objects`);
  console.log(`  linked   ${updates.length} menu_options rows back to Square\n`);
  console.log(
    `  Review them at https://app.squareup${SQUARE_ENV === "production" ? "" : "sandbox"}.com/dashboard/items/library\n`,
  );
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
});
