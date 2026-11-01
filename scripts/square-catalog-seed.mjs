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
 * Reads credentials from the environment or .env.local. Talks to Supabase
 * through PostgREST when SUPABASE_SERVICE_ROLE_KEY is set, or straight to
 * Postgres when only SUPABASE_DB_URL is available and `pg` is installed.
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

const SQUARE_TOKEN = need("SQUARE_ACCESS_TOKEN");
const SQUARE_ENV = process.env.SQUARE_ENVIRONMENT ?? "sandbox";
const SQUARE_BASE =
  SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

// ------------------------------------------------------------ data access ----

const MENU_COLUMNS =
  "id, group_name, label, price_cents, sort_order, square_object_id, square_variation_id";

/**
 * Two ways in, because the service role key and the database URL tend to be
 * available at different moments: PostgREST when we have the key, a direct
 * Postgres connection when we only have the URL.
 */
async function openStore() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;

  if (serviceKey && supabaseUrl) {
    const request = async (pathname, init = {}) => {
      const res = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
        ...init,
        headers: {
          apikey: serviceKey,
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
          prefer: "return=representation",
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
      return text ? JSON.parse(text) : null;
    };

    return {
      kind: "postgrest",
      listOptions: () =>
        request(
          `menu_options?select=${encodeURIComponent(MENU_COLUMNS)}&order=group_name,sort_order`,
        ),
      linkOption: (id, patch) =>
        request(`menu_options?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
          headers: { prefer: "return=minimal" },
        }),
      close: async () => {},
    };
  }

  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error("\n  Set SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL), or SUPABASE_DB_URL.\n");
    process.exit(1);
  }

  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.error("\n  SUPABASE_DB_URL needs the `pg` package: npm i -D pg\n");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  return {
    kind: "postgres",
    listOptions: async () =>
      (
        await client.query(
          `select ${MENU_COLUMNS} from menu_options order by group_name, sort_order`,
        )
      ).rows,
    linkOption: (id, patch) =>
      client.query(
        `update menu_options set square_object_id = $2, square_variation_id = $3 where id = $1`,
        [id, patch.square_object_id ?? null, patch.square_variation_id ?? null],
      ),
    close: () => client.end(),
  };
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

// -------------------------------------------------------- reconciliation ----

/**
 * Square assigns permanent ids on creation, and an update must carry both the
 * id and the current version. Rather than rely on ids stored from an earlier
 * run (which only covers leaves, never their containers), each run reads the
 * live catalog and matches on name. That makes this self-healing: it works
 * against a catalog built by a previous run, by hand, or not at all.
 */
async function fetchExistingCatalog() {
  const body = await square("/v2/catalog/search", {
    method: "POST",
    body: JSON.stringify({ object_types: ["ITEM", "MODIFIER_LIST"] }),
  });

  const items = new Map();
  const lists = new Map();

  for (const object of body.objects ?? []) {
    if (object.type === "ITEM") {
      items.set(object.item_data.name, {
        id: object.id,
        version: object.version,
        variations: new Map(
          (object.item_data.variations ?? []).map((v) => [
            v.item_variation_data.name,
            { id: v.id, version: v.version },
          ]),
        ),
      });
    } else if (object.type === "MODIFIER_LIST") {
      lists.set(object.modifier_list_data.name, {
        id: object.id,
        version: object.version,
        modifiers: new Map(
          (object.modifier_list_data.modifiers ?? []).map((m) => [
            m.modifier_data.name,
            { id: m.id, version: m.version },
          ]),
        ),
      });
    }
  }

  return { items, lists };
}

/** Points a modifier list at its existing counterpart, in place. */
function reconcileList(list, existing) {
  const match = existing.lists.get(list.modifier_list_data.name);
  if (!match) return null;

  list.id = match.id;
  list.version = match.version;

  for (const modifier of list.modifier_list_data.modifiers) {
    const found = match.modifiers.get(modifier.modifier_data.name);
    if (found) {
      modifier.id = found.id;
      modifier.version = found.version;
      // Square rejects this attribute on an existing modifier — a modifier
      // can't be moved between lists — so it must be dropped on update.
      delete modifier.modifier_data.modifier_list_id;
    } else {
      // A brand-new modifier does need to name its (now real) parent list.
      modifier.modifier_data.modifier_list_id = match.id;
    }
  }

  return match.id;
}

function reconcileItem(item, existing) {
  const match = existing.items.get(item.item_data.name);
  if (!match) return;

  item.id = match.id;
  item.version = match.version;

  for (const variation of item.item_data.variations) {
    const found = match.variations.get(variation.item_variation_data.name);
    if (found) {
      variation.id = found.id;
      variation.version = found.version;
      variation.item_variation_data.item_id = match.id;
    }
  }
}

// ----------------------------------------------------------------- main ----

async function main() {
  console.log(`\n  Square catalog sync — ${SQUARE_ENV}\n`);

  const store = await openStore();
  const options = await store.listOptions();
  const byGroup = (group) => options.filter((o) => o.group_name === group);

  const sizes = byGroup("size");
  if (sizes.length === 0) throw new Error("No sizes in menu_options — run the migrations first.");

  const lists = [
    modifierList({ key: "heat", name: "Heat", selectionType: "SINGLE", options: byGroup("heat") }),
    modifierList({
      key: "protein",
      name: "Proteins",
      selectionType: "MULTIPLE",
      options: byGroup("protein"),
      allowQuantity: true,
    }),
    modifierList({
      key: "customization",
      name: "Add-ons",
      selectionType: "MULTIPLE",
      options: byGroup("customization"),
    }),
  ];

  const existing = DRY_RUN ? { items: new Map(), lists: new Map() } : await fetchExistingCatalog();

  // Lists are reconciled first so the plate item can reference their real ids.
  const listIds = lists.map((list) => reconcileList(list, existing) ?? list.id);

  const items = [plateItem(sizes, listIds), ...byGroup("extra").map(extraItem)];
  items.forEach((item) => reconcileItem(item, existing));

  const objects = [...lists, ...items];

  if (DRY_RUN) {
    console.log(JSON.stringify(objects, null, 2));
    console.log(`\n  --dry-run: nothing sent. ${objects.length} top-level objects.\n`);
    await store.close();
    return;
  }

  const response = await square("/v2/catalog/batch-upsert", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `spaghetti-lab-${new Date().toISOString().slice(0, 19)}`,
      batches: [{ objects }],
    }),
  });

  // New objects come back with a temp-id -> permanent-id mapping; anything
  // reconciled above already carries its real id.
  const mapped = new Map(
    (response.id_mappings ?? []).map((m) => [m.client_object_id, m.object_id]),
  );
  const realId = (id) => (id.startsWith("#") ? (mapped.get(id) ?? null) : id);

  // Link menu rows to their Square counterparts so reporting lines up.
  const resolved = new Map();
  for (const list of lists) {
    for (const modifier of list.modifier_list_data.modifiers) {
      resolved.set(modifier.id, realId(modifier.id));
    }
  }
  for (const item of items) {
    for (const variation of item.item_data.variations) {
      resolved.set(variation.id, realId(variation.id));
    }
  }

  let linked = 0;
  for (const option of options) {
    // After reconciliation an object's `id` is already real, so look the row
    // up by both the temp key and whatever the id became.
    const objectId = resolved.get(tempId("mod", option.id)) ?? option.square_object_id ?? null;
    const variationId =
      resolved.get(tempId("var", option.id)) ?? option.square_variation_id ?? null;
    if (!objectId && !variationId) continue;
    await store.linkOption(option.id, {
      square_object_id: objectId,
      square_variation_id: variationId,
    });
    linked++;
  }
  await store.close();

  console.log(`  upserted ${response.objects?.length ?? 0} catalog objects`);
  console.log(`  created  ${response.id_mappings?.length ?? 0} new, the rest updated in place`);
  console.log(`  linked   ${linked} menu_options rows back to Square\n`);
  console.log(
    `  Review them at https://app.squareup${SQUARE_ENV === "production" ? "" : "sandbox"}.com/dashboard/items/library\n`,
  );
}

main().catch((error) => {
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
});
