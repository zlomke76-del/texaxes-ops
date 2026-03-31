// api/admin/send-marketing-email.ts

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { buildMarketingEmail } from "../../lib/email/marketing";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = new Resend(process.env.RESEND_API_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { subject, heading, bodyHtml, segment } = req.body;

    if (!subject || !heading || !bodyHtml) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let query = supabase
      .schema("texaxes")
      .from("customers")
      .select("id, email, first_name")
      .eq("marketing_opt_in", true);

    if (segment === "high_value") {
      query = supabase
        .schema("texaxes")
        .from("customer_value_summary")
        .select("customer_id, email, first_name")
        .gte("lifetime_revenue", 250)
        .eq("marketing_opt_in", true);
    }

    const { data: customers } = await query;

    let sent = 0;

    for (const c of customers || []) {
      if (!c.email) continue;

      const email = buildMarketingEmail({
        subject,
        heading,
        bodyHtml,
      });

      await resend.emails.send({
        from: process.env.WAIVER_FROM_EMAIL!,
        to: c.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      sent++;
    }

    return res.json({ success: true, sent });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Failed to send marketing emails" });
  }
}
