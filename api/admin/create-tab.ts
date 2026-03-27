import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TabType = "booking" | "walk_in" | "spectator" | "retail_only";
type TabStatus = "open" | "closed" | "void";

type CreateTabBody = {
  booking_id?: string | null;
  customer_id?: string | null;
  tab_type: TabType;
  status?: TabStatus;
  party_name?: string | null;
  party_size?: number;
  notes?: string | null;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as CreateTabBody;

    const tabType = body.tab_type;
    const status = body.status || "open";
    const partySize = Math.max(1, Number(body.party_size || 1));
    const bookingId = body.booking_id || null;
    const customerId = body.customer_id || null;
    const partyName = body.party_name?.trim() || null;
    const notes = body.notes?.trim() || null;

    if (!tabType) {
      return badRequest(res, "tab_type is required");
    }

    if (!["booking", "walk_in", "spectator", "retail_only"].includes(tabType)) {
      return badRequest(res, "Invalid tab_type");
    }

    if (!["open", "closed", "void"].includes(status)) {
      return badRequest(res, "Invalid status");
    }

    if (tabType === "booking" && !bookingId) {
      return badRequest(res, "booking_id is required for booking tabs");
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tabs")
      .insert({
        booking_id: bookingId,
        customer_id: customerId,
        tab_type: tabType,
        status,
        party_name: partyName,
        party_size: partySize,
        notes,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("create-tab insert failed", error);
      return res.status(500).json({ error: "Failed to create tab" });
    }

    return res.status(200).json({
      success: true,
      tab: data,
    });
  } catch (err: any) {
    console.error("create-tab failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
