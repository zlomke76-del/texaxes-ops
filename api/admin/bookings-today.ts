import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type WaiverStatus =
  | "complete"
  | "partial"
  | "missing"
  | "expired"
  | "guardian_required";

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function normalizeDate(input?: string) {
  if (!input) {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error("Invalid date");
  }

  return input;
}

function toStartOfDayIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function getWaiverStatus(args: {
  required: number;
  signed: number;
  expired: number;
  guardianRequired: number;
}): WaiverStatus {
  const { required, signed, expired, guardianRequired } = args;

  if (guardianRequired > 0) return "guardian_required";
  if (signed >= required && required > 0) return "complete";
  if (signed > 0) return "partial";
  if (expired > 0) return "expired";
  return "missing";
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
    const date = normalizeDate(req.query.date as string);

    const { data, error } = await supabase
      .schema("texaxes")
      .from("bookings")
      .select(`
        id,
        customer_id,
        start_block_id,
        party_size,
        booking_type,
        booking_source,
        status,
        total_amount,
        tax_amount,
        amount_paid,
        bays_allocated,
        allocation_mode,
        internal_notes,
        customer_notes,
        tax_exempt,
        tax_exempt_reason,
        tax_exempt_status,
        created_at,
        customers (
          first_name,
          last_name,
          email,
          phone
        ),
        time_blocks (
          block_date,
          start_time,
          end_time
        )
      `)
      .eq("time_blocks.block_date", date)
      .order("time_blocks.start_time", { ascending: true });

    if (error) {
      console.error("bookings-today query error", error);
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    const rows = data || [];
    const bookingIds = rows.map((row: any) => row.id);

    let waiverCounts = new Map<
      string,
      {
        signed: number;
        expired: number;
        guardianRequired: number;
      }
    >();

    if (bookingIds.length > 0) {
      const { data: waiverRows, error: waiverError } = await supabase
        .schema("texaxes")
        .from("waivers")
        .select("booking_id, expires_at, is_minor, guardian_customer_id")
        .in("booking_id", bookingIds);

      if (waiverError) {
        console.error("bookings-today waiver query error", waiverError);
        return res.status(500).json({ error: "Failed to fetch waiver data" });
      }

      const validOnOrAfter = new Date(toStartOfDayIso(date));

      for (const waiver of waiverRows || []) {
        const bookingId = waiver.booking_id as string | null;
        if (!bookingId) continue;

        const current = waiverCounts.get(bookingId) || {
          signed: 0,
          expired: 0,
          guardianRequired: 0,
        };

        const expiresAt = waiver.expires_at ? new Date(waiver.expires_at) : null;
        const isExpired = !expiresAt || expiresAt < validOnOrAfter;
        const needsGuardian = Boolean(waiver.is_minor) && !waiver.guardian_customer_id;

        if (needsGuardian) {
          current.guardianRequired += 1;
        } else if (isExpired) {
          current.expired += 1;
        } else {
          current.signed += 1;
        }

        waiverCounts.set(bookingId, current);
      }
    }

    const bookings = rows.map((row: any) => {
      const customer = row.customers || {};
      const block = row.time_blocks || {};
      const requiredWaivers = Number(row.party_size || 0);

      const waiverCount = waiverCounts.get(row.id) || {
        signed: 0,
        expired: 0,
        guardianRequired: 0,
      };

      const waiverStatus = getWaiverStatus({
        required: requiredWaivers,
        signed: waiverCount.signed,
        expired: waiverCount.expired,
        guardianRequired: waiverCount.guardianRequired,
      });

      return {
        booking_id: row.id,
        customer_id: row.customer_id,

        start_time: block.start_time,
        end_time: block.end_time,

        customer_name: `${customer.first_name || ""} ${customer.last_name || ""}`.trim(),
        email: customer.email,
        phone: customer.phone,

        party_size: row.party_size,
        booking_type: row.booking_type,
        booking_source: row.booking_source,

        booking_status: row.status,
        payment_status:
          Number(row.amount_paid || 0) >= Number(row.total_amount || 0)
            ? "paid"
            : "pending",

        waiver_required: requiredWaivers,
        waiver_signed: waiverCount.signed,
        waiver_status: waiverStatus,
        waiver_url: `${process.env.FRONTEND_URL}/waiver?booking=${row.id}`,

        total_amount: Number(row.total_amount || 0),
        tax_amount: Number(row.tax_amount || 0),
        amount_paid: Number(row.amount_paid || 0),

        customer_notes: row.customer_notes,
        internal_notes: row.internal_notes,

        allocation_mode: row.allocation_mode,
        bays_allocated: row.bays_allocated,

        tax_exempt: row.tax_exempt,
        tax_exempt_reason: row.tax_exempt_reason,
        tax_exempt_status: row.tax_exempt_status,

        created_at: row.created_at,
      };
    });

    const expected = bookings.reduce((sum, b) => sum + b.total_amount, 0);
    const collected = bookings.reduce((sum, b) => sum + b.amount_paid, 0);

    const summary = {
      booking_count: bookings.length,
      paid_count: bookings.filter((b) => b.payment_status === "paid").length,
      unpaid_count: bookings.filter((b) => b.payment_status !== "paid").length,
      checked_in_count: bookings.filter((b) => b.booking_status === "checked_in").length,
      completed_count: bookings.filter((b) => b.booking_status === "completed").length,
      expected_revenue: expected,
      collected_revenue: collected,
      waiver_complete_count: bookings.filter((b) => b.waiver_status === "complete").length,
      waiver_partial_count: bookings.filter((b) => b.waiver_status === "partial").length,
      waiver_missing_count: bookings.filter((b) => b.waiver_status === "missing").length,
    };

    return res.status(200).json({
      date,
      summary,
      bookings,
    });
  } catch (err: any) {
    console.error("bookings-today failed", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
