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

    /**
     * Pull bookings + customer info
     */
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

    const bookings = (data || []).map((row: any) => {
      const customer = row.customers || {};
      const block = row.time_blocks || {};

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
          row.amount_paid >= row.total_amount ? "paid" : "pending",

        waiver_status: "missing", // placeholder (hook later)
        waiver_url: `${process.env.FRONTEND_URL}/waiver?booking=${row.id}`,

        total_amount: Number(row.total_amount || 0),
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

    /**
     * Summary
     */
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
