import type { SupabaseClient } from "jsr:@supabase/supabase-js@^2.118.0";
import { FROM_EMAIL, REPLY_TO, requireEnv } from "../env.ts";
import { toPlainText } from "./layout.ts";
import type { RenderedEmail } from "./templates.ts";

export interface SendOptions {
  to: string;
  email: RenderedEmail;
  template: string;
  orderId?: string;
  /** Skip if this (order, template) pair already went out. */
  once?: boolean;
  replyTo?: string;
}

/**
 * Sends through Resend and records the attempt in email_log.
 *
 * Email never fails an order: a confirmation that doesn't send is logged and
 * surfaced in the admin dashboard, but the customer has still paid and the
 * kitchen still has the ticket.
 */
export async function sendEmail(db: SupabaseClient, opts: SendOptions): Promise<boolean> {
  if (opts.once && opts.orderId) {
    const { data: already } = await db
      .from("email_log")
      .select("id")
      .eq("order_id", opts.orderId)
      .eq("template", opts.template)
      .eq("status", "sent")
      .maybeSingle();
    if (already) return false;
  }

  const log = async (status: string, resendId: string | null, error: string | null) => {
    await db.from("email_log").insert({
      order_id: opts.orderId ?? null,
      template: opts.template,
      to_email: opts.to,
      resend_id: resendId,
      status,
      error,
    });
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [opts.to],
        reply_to: opts.replyTo ?? REPLY_TO,
        subject: opts.email.subject,
        html: opts.email.html,
        text: toPlainText(opts.email.html),
        tags: [{ name: "template", value: opts.template }],
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("resend error", res.status, JSON.stringify(body));
      await log("failed", null, `${res.status}: ${body?.message ?? "unknown"}`);
      return false;
    }

    await log("sent", body?.id ?? null, null);
    return true;
  } catch (error) {
    console.error("resend threw", error);
    await log("failed", null, String(error));
    return false;
  }
}
