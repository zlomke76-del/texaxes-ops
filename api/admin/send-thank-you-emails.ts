import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { buildThankYouEmail } from "../../lib/email/thankYou";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.WAIVER_FROM_EMAIL!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 🔒 Optional security
    const CRON_SECRET = process.env.CRON_SECRET;
    if (CRON_SECRET) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${CRON_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    const nowIso = new Date().toISOString();

    const { data: bookings, error } = await supabase
      .schema("texaxes")
      .from("bookings")
      .select(`
        id,
        customer_id,
        thank_you_email_scheduled_for,
        thank_you_email_sent_at,
        customers (
          email,
          first_name
        )
      `)
      .not("thank_you_email_scheduled_for", "is", null)
      .is("thank_you_email_sent_at", null)
      .lte("thank_you_email_scheduled_for", nowIso);

    if (error) throw error;

    if (!bookings || bookings.length === 0) {
      return res.json({
        success: true,
        processed: 0,
        sent: 0,
      });
    }

    let sentCount = 0;

    for (const booking of bookings) {
      const email = booking.customers?.email?.trim();
      const firstName = booking.customers?.first_name || "there";

      if (!email) continue;

      try {
        const emailContent = buildThankYouEmail({
          firstName,
          couponCode: "THANKYOU20",
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
          console.error("Email send failed", sendError);
          continue;
        }

        await supabase
          .schema("texaxes")
          .from("bookings")
          .update({
            thank_you_email_sent_at: new Date().toISOString(),
          })
          .eq("id", booking.id);

        sentCount++;
      } catch (err) {
        console.error("Processing error", err);
      }
    }

    return res.json({
      success: true,
      processed: bookings.length,
      sent: sentCount,
    });
  } catch (error) {
    console.error("send-thank-you-emails failed", error);
    return res.status(500).json({
      error: "Failed to send thank-you emails",
    });
  }
}
