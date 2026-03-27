import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type VoidLineItemBody = {
  line_item_id: string;
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
    const body = (req.body || {}) as VoidLineItemBody;
    const lineItemId = body.line_item_id?.trim();
    const note = body.note?.trim() || null;

    if (!lineItemId) return badRequest(res, "line_item_id is required");

    const { data: existing, error: existingError } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .select("*")
      .eq("id", lineItemId)
      .single();

    if (existingError || !existing) {
      console.error("void-line-item load failed", existingError);
      return res.status(404).json({ error: "Line item not found" });
    }

    const currentNote = existing.note?.trim() || "";
    const voidMarker = "[VOID LINE ITEM]";
    if (currentNote.includes(voidMarker)) {
      return res.status(400).json({ error: "Line item already voided" });
    }

    const nextNote = [currentNote, voidMarker, note].filter(Boolean).join("\n");

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .update({
        quantity: 0,
        unit_price: 0,
        line_subtotal: 0,
        line_tax: 0,
        line_total: 0,
        note: nextNote,
      })
      .eq("id", lineItemId)
      .select()
      .single();

    if (error || !data) {
      console.error("void-line-item update failed", error);
      return res.status(500).json({ error: "Failed to void line item" });
    }

    await recalcTab(existing.tab_id);

    const { data: tab, error: tabError } = await supabase
      .schema("texaxes")
      .from("tabs")
      .select("*")
      .eq("id", existing.tab_id)
      .single();

    if (tabError) {
      console.error("void-line-item tab reload failed", tabError);
      return res.status(500).json({ error: "Line item voided, but failed to reload tab" });
    }

    return res.status(200).json({
      success: true,
      line_item: data,
      tab,
    });
  } catch (err: any) {
    console.error("void-line-item failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
