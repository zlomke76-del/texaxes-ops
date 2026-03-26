import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PUBLIC_MAX_PARTY_SIZE = 24;
const PREFERRED_THROWERS_PER_BAY = 4;
const MAX_THROWERS_PER_BAY = 6;

type CapacityRow = {
  time_block_id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  is_open: boolean;
  is_bookable: boolean;
  total_bays: number;
  bays_used: number;
  bays_open: number;
};

function methodNotAllowed(res: any) {
  res.setHeader("Allow", "GET");
  return res.status(405).json({ error: "Method not allowed" });
}

function normalizeDate(input: string): string {
  const value = String(input || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date");
  }

  const dt = new Date(`${value}T00:00:00`);
  if (Number.isNaN(dt.getTime())) {
    throw new Error("Invalid date");
  }

  return value;
}

function computeBayRequirements(throwers: number) {
  return {
    preferred: Math.ceil(throwers / PREFERRED_THROWERS_PER_BAY),
    minimum: Math.ceil(throwers / MAX_THROWERS_PER_BAY),
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return methodNotAllowed(res);
  }

  try {
    const { date, throwers } = req.query;

    if (!date) {
      return res.status(400).json({ error: "Missing date" });
    }

    const normalizedDate = normalizeDate(date);
    const partySize = throwers ? Number(throwers) : null;

    if (partySize !== null) {
      if (!Number.isInteger(partySize) || partySize <= 0) {
        return res.status(400).json({ error: "Invalid throwers" });
      }

      if (partySize > PUBLIC_MAX_PARTY_SIZE) {
        return res.status(400).json({
          error: "Group too large for public booking. Contact Tex Axes for a full venue booking.",
        });
      }
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("v_block_capacity")
      .select(
        "time_block_id, block_date, start_time, end_time, is_open, is_bookable, total_bays, bays_used, bays_open"
      )
      .eq("block_date", normalizedDate)
      .order("start_time", { ascending: true });

    if (error) {
      throw error;
    }

    const rows = (data || []) as CapacityRow[];

    const slots = rows
      .filter((row) => row.is_open && row.is_bookable)
      .map((row) => {
        if (!partySize) {
          let state: "available" | "limited" | "full" = "available";

          if (row.bays_open <= 0) {
            state = "full";
          } else if (row.bays_open === 1) {
            state = "limited";
          }

          return {
            time_block_id: row.time_block_id,
            start: row.start_time.slice(0, 5),
            end: row.end_time.slice(0, 5),
            open_bays: row.bays_open,
            total_bays: row.total_bays,
            state,
          };
        }

        const { preferred, minimum } = computeBayRequirements(partySize);

        let state: "available" | "limited" | "full";
        if (row.bays_open >= preferred) {
          state = "available";
        } else if (row.bays_open >= minimum) {
          state = "limited";
        } else {
          state = "full";
        }

        return {
          time_block_id: row.time_block_id,
          start: row.start_time.slice(0, 5),
          end: row.end_time.slice(0, 5),
          open_bays: row.bays_open,
          total_bays: row.total_bays,
          preferred_bays_required: preferred,
          minimum_bays_required: minimum,
          state,
        };
      });

    return res.status(200).json({
      date: normalizedDate,
      throwers: partySize,
      slots,
    });
 } catch (error: any) {
  console.error("GET /api/availability failed", error);

  return res.status(500).json({
    error: "Availability failed",
    details: error?.message || String(error),
  });
}
