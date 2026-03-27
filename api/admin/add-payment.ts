import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type PaymentMethod =
  | "online_stripe"
  | "in_store_terminal"
  | "cash"
  | "comp"
  | "manual_adjustment";

type PaymentStatus = "pending" | "completed" | "void";

type AddPaymentBody = {
  tab_id: string;
  amount: number;
  payment_method: PaymentMethod;
  status?: PaymentStatus;
  reference?: string | null;
  note?: string | null;
  collected_by?: string | null;
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
    const body = (req.body || {}) as AddPaymentBody;

    const tabId = body.tab_id?.trim();
    const amount = Number(body.amount || 0);
    const paymentMethod = body.payment_method;
    const status = body.status || "completed";
    const reference = body.reference?.trim() || null;
    const note = body.note?.trim() || null;
    const collectedBy = body.collected_by?.trim() || null;

    if (!tabId) return badRequest(res, "tab_id is required");
    if (!paymentMethod) return badRequest(res, "payment_method is required");

    if (
      ![
        "online_stripe",
        "in_store_terminal",
        "cash",
        "comp",
        "manual_adjustment",
      ].includes(paymentMethod)
    ) {
      return badRequest(res, "Invalid payment_method");
    }

    if (!["pending", "completed", "void"].includes(status)) {
      return badRequest(res, "Invalid status");
    }

    if (!Number.isFinite(amount) || amount < 0) {
      return badRequest(res, "Invalid amount");
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .insert({
        tab_id: tabId,
        amount,
        payment_method: paymentMethod,
        status,
        reference,
        note,
        collected_by: collectedBy,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("add-payment insert failed", error);
      return res.status(500).json({ error: "Failed to add payment" });
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
      return res.status(500).json({ error: "Payment added, but failed to reload tab" });
    }

    return res.status(200).json({
      success: true,
      payment: data,
      tab,
    });
  } catch (err: any) {
    console.error("add-payment failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
