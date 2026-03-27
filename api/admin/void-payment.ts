import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type VoidPaymentBody = {
  payment_id: string;
  note?: string | null;
};

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function badRequest(res: VercelResponse, message: string) {
  return res.status(400).json({ error: message });
}

async function recalcTab(tabId: string) {
  const { error } = await supabase.rpc("recalculate_tab_totals", {
    p_tab_id: tabId,
  });

  if (error) throw error;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as VoidPaymentBody;
    const paymentId = body.payment_id?.trim();
    const note = body.note?.trim() || null;

    if (!paymentId) return badRequest(res, "payment_id is required");

    const { data: existing, error: existingError } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .select("*")
      .eq("id", paymentId)
      .single();

    if (existingError || !existing) {
      console.error("void-payment load failed", existingError);
      return res.status(404).json({ error: "Payment not found" });
    }

    if (existing.status === "void") {
      return res.status(400).json({ error: "Payment already voided" });
    }

    const currentNote = existing.note?.trim() || "";
    const voidMarker = "[VOID PAYMENT]";
    const nextNote = [currentNote, voidMarker, note].filter(Boolean).join("\n");

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .update({
        status: "void",
        note: nextNote,
      })
      .eq("id", paymentId)
      .select()
      .single();

    if (error || !data) {
      console.error("void-payment update failed", error);
      return res.status(500).json({ error: "Failed to void payment" });
    }

    await recalcTab(existing.tab_id);

    const { data: tab, error: tabError } = await supabase
      .schema("texaxes")
      .from("tabs")
      .select("*")
      .eq("id", existing.tab_id)
      .single();

    if (tabError) {
      console.error("void-payment tab reload failed", tabError);
      return res.status(500).json({ error: "Payment voided, but failed to reload tab" });
    }

    return res.status(200).json({
      success: true,
      payment: data,
      tab,
    });
  } catch (err: any) {
    console.error("void-payment failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
