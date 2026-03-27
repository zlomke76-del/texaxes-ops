import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TabStatus = "open" | "closed" | "void";

type UpdateTabStatusBody = {
  tab_id: string;
  status: TabStatus;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = (req.body || {}) as UpdateTabStatusBody;
    const tabId = body.tab_id?.trim();
    const status = body.status;
    const note = body.note?.trim() || null;

    if (!tabId) return badRequest(res, "tab_id is required");
    if (!status) return badRequest(res, "status is required");
    if (!["open", "closed", "void"].includes(status)) {
      return badRequest(res, "Invalid status");
    }

    const updatePayload: Record<string, unknown> = {
      status,
      closed_at: status === "closed" || status === "void" ? new Date().toISOString() : null,
    };

    if (note) {
      const { data: existing, error: existingError } = await supabase
        .schema("texaxes")
        .from("tabs")
        .select("notes")
        .eq("id", tabId)
        .single();

      if (existingError) {
        console.error("update-tab-status load existing tab failed", existingError);
        return res.status(404).json({ error: "Tab not found" });
      }

      updatePayload.notes = existing?.notes
        ? `${existing.notes}\n[STATUS ${status.toUpperCase()}] ${note}`
        : `[STATUS ${status.toUpperCase()}] ${note}`;
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tabs")
      .update(updatePayload)
      .eq("id", tabId)
      .select()
      .single();

    if (error || !data) {
      console.error("update-tab-status failed", error);
      return res.status(500).json({ error: "Failed to update tab status" });
    }

    return res.status(200).json({
      success: true,
      tab: data,
    });
  } catch (err: any) {
    console.error("update-tab-status failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
