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

type SlotState = "available" | "limited" | "full";

function setCors(req: any, res: any) {
  const origin = req.headers.origin || "";
  const frontendUrl = process.env.FRONTEND_URL || "";

  const isAllowed =
    origin === frontendUrl ||
    origin.includes("vercel.app") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1");

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function methodNotAllowed(res: any) {
  res.setHeader("Allow", "GET, OPTIONS");
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

function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getSlotState(row: CapacityRow, partySize: number | null): {
  state: SlotState;
  preferred_bays_required?: number;
  minimum_bays_required?: number;
} {
  if (!partySize) {
    let state: SlotState = "available";

    if (row.bays_open <= 0) {
      state = "full";
    } else if (row.bays_open === 1) {
      state = "limited";
    }

    return { state };
  }

  const { preferred, minimum } = computeBayRequirements(partySize);

  let state: SlotState;
  if (row.bays_open >= preferred) {
    state = "available";
  } else if (row.bays_open >= minimum) {
    state = "limited";
  } else {
    state = "full";
  }

  return {
    state,
    preferred_bays_required: preferred,
    minimum_bays_required: minimum,
  };
}

function buildSlotTimes(row: CapacityRow): string[] {
  const start = hhmmToMinutes(row.start_time);
  const end = hhmmToMinutes(row.end_time);
  const duration = end - start;

  const times = [minutesToHHMM(start)];

  if (duration >= 60) {
    times.push(minutesToHHMM(start + 30));
  }

  return times;
}

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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
      .flatMap((row) => {
        const slotMeta = getSlotState(row, partySize);
        const slotTimes = buildSlotTimes(row);

        return slotTimes.map((slotStart, index) => ({
          time_block_id: row.time_block_id,
          slot_key: `${row.time_block_id}:${slotStart}`,
          start: slotStart,
          end: row.end_time.slice(0, 5),
          open_bays: row.bays_open,
          total_bays: row.total_bays,
          state: slotMeta.state,
          preferred_bays_required: slotMeta.preferred_bays_required,
          minimum_bays_required: slotMeta.minimum_bays_required,
          derived_half_hour: index > 0,
        }));
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
}
