import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code, booking_id } = req.body || {};

    if (!code) {
      return res.status(400).json({ error: "Missing code" });
    }

    const nowIso = new Date().toISOString();

    const { data: offer, error } = await supabase
      .schema("texaxes")
      .from("customer_offers")
      .select("*")
      .eq("code", code.trim().toUpperCase())
      .maybeSingle();

    if (error) throw error;

    if (!offer) {
      return res.status(404).json({ error: "Invalid code" });
    }

    if (offer.status !== "active") {
      return res.status(400).json({ error: "Offer not active" });
    }

    if (offer.expires_at && offer.expires_at < nowIso) {
      return res.status(400).json({ error: "Offer expired" });
    }

    return res.json({
      success: true,
      offer: {
        id: offer.id,
        code: offer.code,
        discount_type: offer.discount_type,
        discount_value: offer.discount_value,
        expires_at: offer.expires_at,
      },
    });
  } catch (err: any) {
    console.error("redeem-offer failed", err);
    return res.status(500).json({
      error: err?.message || "Failed to redeem offer",
    });
  }
}
