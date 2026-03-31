import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function badRequest(res: VercelResponse, message: string) {
  return res.status(400).json({ error: message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const tabId =
      typeof req.query.tab_id === "string" ? req.query.tab_id.trim() : "";

    if (!tabId) {
      return badRequest(res, "tab_id is required");
    }

    const { data: tab, error: tabError } = await supabase
      .schema("texaxes")
      .from("tabs")
      .select(`
        id,
        booking_id,
        customer_id,
        tab_type,
        status,
        party_name,
        party_size,
        notes,
        subtotal,
        tax_total,
        grand_total,
        amount_paid,
        balance_due,
        opened_at,
        closed_at,
        created_at,
        updated_at,
        customers (
          id,
          first_name,
          last_name,
          email,
          phone
        ),
        bookings (
          id,
          booking_type,
          booking_source,
          status,
          party_size,
          total_amount,
          customer_notes,
          internal_notes
        )
      `)
      .eq("id", tabId)
      .single();

    if (tabError || !tab) {
      console.error("get-tab tab query failed", tabError);
      return res.status(404).json({ error: "Tab not found" });
    }

    const { data: lineItems, error: lineItemsError } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .select(`
        id,
        tab_id,
        item_type,
        description,
        quantity,
        unit_price,
        taxable,
        tax_rate,
        tax_exempt_override,
        tax_exempt_reason,
        line_subtotal,
        line_tax,
        line_total,
        note,
        created_at,
        updated_at
      `)
      .eq("tab_id", tabId)
      .order("created_at", { ascending: true });

    if (lineItemsError) {
      console.error("get-tab line items query failed", lineItemsError);
      return res.status(500).json({ error: "Failed to load tab line items" });
    }

    const { data: payments, error: paymentsError } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .select(`
        id,
        tab_id,
        payment_method,
        status,
        amount,
        reference,
        note,
        collected_by,
        created_at,
        updated_at
      `)
      .eq("tab_id", tabId)
      .order("created_at", { ascending: true });

    if (paymentsError) {
      console.error("get-tab payments query failed", paymentsError);
      return res.status(500).json({ error: "Failed to load tab payments" });
    }

    return res.status(200).json({
      success: true,
      tab,
      line_items: lineItems || [],
      payments: payments || [],
    });
  } catch (err: any) {
    console.error("get-tab failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
