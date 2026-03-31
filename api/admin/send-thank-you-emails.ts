import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { buildThankYouEmail } from "../../lib/email/thankYou";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

const FROM_EMAIL =
  process.env.WAIVER_FROM_EMAIL || "Tex Axes <onboarding@resend.dev>";

type OfferRow = {
  id: string;
  code: string;
  expires_at: string | null;
};

function generateOfferCode(prefix = "TEX"): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = `${prefix}-`;
  for (let i = 0; i < 6; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function getOrCreateOffer(params: {
  bookingId: string;
  customerId: string;
}): Promise<OfferRow> {
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await supabase
    .schema("texaxes")
    .from("customer_offers")
    .select("id, code, expires_at")
    .eq("booking_id", params.bookingId)
    .eq("customer_id", params.customerId)
    .eq("offer_type", "thank_you")
    .eq("status", "active")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle<OfferRow>();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return existing;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateOfferCode("TEX");

    const { data, error } = await supabase
      .schema("texaxes")
      .from("customer_offers")
      .insert({
        booking_id: params.bookingId,
        customer_id: params.customerId,
        offer_type: "thank_you",
        code,
        discount_type: "percent",
        discount_value: 20,
        status: "active",
        issued_at: nowIso,
        expires_at: expiresAt.toISOString(),
        metadata: {
          source: "thank_you_email",
          valid_days: 30,
        },
      })
      .select("id, code, expires_at")
      .single<OfferRow>();

    if (!error && data) {
      return data;
    }

    const message = String(error?.message || "").toLowerCase();
    const isDuplicate =
      message.includes("duplicate") || message.includes("unique");

    if (!isDuplicate || attempt === 4) {
      throw error || new Error("Failed to create customer offer");
    }
  }

  throw new Error("Failed to create customer offer");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const nowIso = new Date().toISOString();

    const { data: bookings, error } = await supabase
      .schema("texaxes")
      .from("bookings")
      .select(
        `
        id,
        customer_id,
        thank_you_email_scheduled_for,
        thank_you_email_sent_at,
        customers (
          email,
          first_name,
          last_name
        )
      `
      )
      .not("thank_you_email_scheduled_for", "is", null)
      .is("thank_you_email_sent_at", null)
      .lte("thank_you_email_scheduled_for", nowIso);

    if (error) {
      throw error;
    }

    if (!bookings || bookings.length === 0) {
      return res.json({
        success: true,
        processed: 0,
        sent: 0,
        skipped: [],
        failed: [],
      });
    }

    let sent = 0;
    const skipped: Array<{ booking_id: string; reason: string }> = [];
    const failed: Array<{ booking_id: string; error: string }> = [];

    for (const booking of bookings as any[]) {
      const bookingId = String(booking.id);
      const customerId = String(booking.customer_id);
      const email = booking.customers?.email?.trim();
      const firstName = booking.customers?.first_name || "there";

      if (!email) {
        skipped.push({
          booking_id: bookingId,
          reason: "missing_customer_email",
        });
        continue;
      }

      try {
        const offer = await getOrCreateOffer({
          bookingId,
          customerId,
        });

        const emailContent = buildThankYouEmail({
          firstName,
          couponCode: offer.code,
          discountLabel: "20% off",
          validDays: 30,
        });

        const { error: sendError } = await resend.emails.send({
          from: FROM_EMAIL,
          to: email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        if (sendError) {
          failed.push({
            booking_id: bookingId,
            error: sendError.message || "resend_send_failed",
          });
          continue;
        }

        const sentAt = new Date().toISOString();

        const { error: updateError } = await supabase
          .schema("texaxes")
          .from("bookings")
          .update({
            thank_you_email_sent_at: sentAt,
          })
          .eq("id", bookingId)
          .is("thank_you_email_sent_at", null);

        if (updateError) {
          failed.push({
            booking_id: bookingId,
            error: updateError.message || "failed_to_mark_sent",
          });
          continue;
        }

        await supabase.schema("texaxes").from("audit_log").insert({
          entity_type: "booking",
          entity_id: bookingId,
          action: "thank_you_email_sent",
          actor_type: "system",
          actor_id: null,
          metadata: {
            booking_id: bookingId,
            customer_id: customerId,
            email,
            thank_you_email_scheduled_for: booking.thank_you_email_scheduled_for,
            thank_you_email_sent_at: sentAt,
            coupon_code: offer.code,
            customer_offer_id: offer.id,
            offer_expires_at: offer.expires_at,
          },
        });

        sent += 1;
      } catch (err: any) {
        failed.push({
          booking_id: bookingId,
          error: err?.message || "processing_error",
        });
      }
    }

    return res.json({
      success: true,
      processed: bookings.length,
      sent,
      skipped,
      failed,
    });
  } catch (error: any) {
    console.error("send-thank-you-emails failed", error);
    return res.status(500).json({
      error: error?.message || "Failed to send thank-you emails",
    });
  }
}
