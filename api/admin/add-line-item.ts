import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ItemType = "booking" | "drink" | "snack" | "retail" | "axe" | "custom";

type AddLineItemBody = {
  tab_id: string;
  item_type: ItemType;
  description: string;
  quantity?: number;
  unit_price: number;
  taxable?: boolean;
  tax_rate?: number;
  tax_exempt_override?: boolean;
  tax_exempt_reason?: string | null;
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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
    const body = (req.body || {}) as AddLineItemBody;

    const tabId = body.tab_id?.trim();
    const itemType = body.item_type;
    const description = body.description?.trim();
    const quantity = Math.max(1, Number(body.quantity || 1));
    const unitPrice = Number(body.unit_price || 0);
    const taxable = body.taxable !== false;
    const taxRate = Number.isFinite(Number(body.tax_rate))
      ? Number(body.tax_rate)
      : 0.0825;
    const taxExemptOverride = Boolean(body.tax_exempt_override);
    const taxExemptReason = body.tax_exempt_reason?.trim() || null;
    const note = body.note?.trim() || null;

    if (!tabId) return badRequest(res, "tab_id is required");
    if (!itemType) return badRequest(res, "item_type is required");
    if (!description) return badRequest(res, "description is required");

    if (!["booking", "drink", "snack", "retail", "axe", "custom"].includes(itemType)) {
      return badRequest(res, "Invalid item_type");
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return badRequest(res, "Invalid quantity");
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return badRequest(res, "Invalid unit_price");
    }

    const lineSubtotal = roundMoney(quantity * unitPrice);
    const effectiveTaxable = taxable && !taxExemptOverride;
    const lineTax = effectiveTaxable ? roundMoney(lineSubtotal * taxRate) : 0;
    const lineTotal = roundMoney(lineSubtotal + lineTax);

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .insert({
        tab_id: tabId,
        item_type: itemType,
        description,
        quantity,
        unit_price: unitPrice,
        taxable,
        tax_rate: taxRate,
        tax_exempt_override: taxExemptOverride,
        tax_exempt_reason: taxExemptOverride ? taxExemptReason : null,
        line_subtotal: lineSubtotal,
        line_tax: lineTax,
        line_total: lineTotal,
        note,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("add-line-item insert failed", error);
      return res.status(500).json({ error: "Failed to add line item" });
    }

    await recalcTab(tabId);

    const { data: tab, error: tabError } = await supabase
      .schema("texaxes")
      .from("tabs")
      .select("*")
      .eq("id", tabId)
      .single();

    if (tabError) {
      console.error("tab reload failed", tabError);
      return res.status(500).json({ error: "Line item added, but failed to reload tab" });
    }

    return res.status(200).json({
      success: true,
      line_item: data,
      tab,
    });
  } catch (err: any) {
    console.error("add-line-item failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
