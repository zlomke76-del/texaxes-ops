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
  res.setHeader("Vary", "Origin");
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

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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

    const { data: timeBlocks, error: timeBlocksError } = await supabase
      .schema("texaxes")
      .from("time_blocks")
      .select("id, block_date, start_time, end_time")
      .eq("block_date", date)
      .order("start_time", { ascending: true });

    if (timeBlocksError) {
      console.error(
        "bookings-today time_blocks query error",
        JSON.stringify(timeBlocksError, null, 2)
      );
      return res.status(500).json({ error: "Failed to fetch time blocks" });
    }

    const blocks = timeBlocks || [];
    const blockMap = new Map<string, any>(blocks.map((block: any) => [block.id, block]));
    const blockIds = blocks.map((block: any) => block.id);

    if (blockIds.length === 0) {
      return res.status(200).json({
        date,
        summary: {
          booking_count: 0,
          paid_count: 0,
          unpaid_count: 0,
          checked_in_count: 0,
          completed_count: 0,
          expected_revenue: 0,
          collected_revenue: 0,
          waiver_complete_count: 0,
          waiver_partial_count: 0,
          waiver_missing_count: 0,
        },
        bookings: [],
      });
    }

    const { data: bookingRows, error: bookingsError } = await supabase
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
        bays_allocated,
        allocation_mode,
        internal_notes,
        customer_notes,
        created_at
      `)
      .in("start_block_id", blockIds)
      .order("created_at", { ascending: true });

    if (bookingsError) {
      console.error(
        "bookings-today bookings query error",
        JSON.stringify(bookingsError, null, 2)
      );
      return res.status(500).json({ error: "Failed to fetch bookings" });
    }

    const rows = bookingRows || [];

    if (rows.length === 0) {
      return res.status(200).json({
        date,
        summary: {
          booking_count: 0,
          paid_count: 0,
          unpaid_count: 0,
          checked_in_count: 0,
          completed_count: 0,
          expected_revenue: 0,
          collected_revenue: 0,
          waiver_complete_count: 0,
          waiver_partial_count: 0,
          waiver_missing_count: 0,
        },
        bookings: [],
      });
    }

    const bookingIds = rows.map((row: any) => row.id);
    const customerIds = [...new Set(rows.map((row: any) => row.customer_id).filter(Boolean))];

    const customerMap = new Map<string, any>();
    if (customerIds.length > 0) {
      const { data: customerRows, error: customersError } = await supabase
        .schema("texaxes")
        .from("customers")
        .select("id, first_name, last_name, email, phone")
        .in("id", customerIds);

      if (customersError) {
        console.error(
          "bookings-today customers query error",
          JSON.stringify(customersError, null, 2)
        );
        return res.status(500).json({ error: "Failed to fetch customers" });
      }

      for (const customer of customerRows || []) {
        customerMap.set(customer.id, customer);
      }
    }

    const paymentMap = new Map<string, number>();
    if (bookingIds.length > 0) {
      const { data: paymentRows, error: paymentsError } = await supabase
        .schema("texaxes")
        .from("payments")
        .select("booking_id, amount, status")
        .in("booking_id", bookingIds);

      if (paymentsError) {
        console.error(
          "bookings-today payments query error",
          JSON.stringify(paymentsError, null, 2)
        );
        return res.status(500).json({ error: "Failed to fetch payments" });
      }

      for (const payment of paymentRows || []) {
        if (payment.status === "paid") {
          const current = paymentMap.get(payment.booking_id) || 0;
          paymentMap.set(payment.booking_id, current + Number(payment.amount || 0));
        }
      }
    }

    const waiverCounts = new Map<
      string,
      {
        signed: number;
        expired: number;
        guardianRequired: number;
      }
    >();

    if (customerIds.length > 0) {
      const { data: waiverRows, error: waiverError } = await supabase
        .schema("texaxes")
        .from("waivers")
        .select("customer_id, expires_at, is_minor, parent_customer_id")
        .in("customer_id", customerIds);

      if (waiverError) {
        console.error(
          "bookings-today waiver query error",
          JSON.stringify(waiverError, null, 2)
        );
        return res.status(500).json({ error: "Failed to fetch waiver data" });
      }

      const validOnOrAfter = new Date(toStartOfDayIso(date));

      for (const waiver of waiverRows || []) {
        const customerId = waiver.customer_id as string | null;
        if (!customerId) continue;

        for (const booking of rows) {
          if (booking.customer_id !== customerId) continue;

          const current = waiverCounts.get(booking.id) || {
            signed: 0,
            expired: 0,
            guardianRequired: 0,
          };

          const expiresAt = waiver.expires_at ? new Date(waiver.expires_at) : null;
          const isExpired = !expiresAt || expiresAt < validOnOrAfter;
          const needsGuardian = Boolean(waiver.is_minor) && !waiver.parent_customer_id;

          if (needsGuardian) {
            current.guardianRequired += 1;
          } else if (isExpired) {
            current.expired += 1;
          } else {
            current.signed += 1;
          }

          waiverCounts.set(booking.id, current);
        }
      }
    }

    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

    const bookings = rows
      .map((row: any) => {
        const customer = customerMap.get(row.customer_id) || {};
        const block = blockMap.get(row.start_block_id) || {};
        const requiredWaivers = Math.max(0, Number(row.party_size || 0));
        const amountPaid = paymentMap.get(row.id) || 0;

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

          start_time: block.start_time || null,
          end_time: block.end_time || null,

          customer_name:
            `${customer.first_name || ""} ${customer.last_name || ""}`.trim() ||
            "Unknown Customer",
          email: customer.email || null,
          phone: customer.phone || null,

          party_size: Number(row.party_size || 0),
          booking_type: row.booking_type || null,
          booking_source: row.booking_source || null,

          booking_status: row.status || "pending",
          payment_status:
            amountPaid >= Number(row.total_amount || 0) &&
            Number(row.total_amount || 0) > 0
              ? "paid"
              : "pending",

          waiver_required: requiredWaivers,
          waiver_signed: waiverCount.signed,
          waiver_status: waiverStatus,
          waiver_url: frontendUrl
            ? `${frontendUrl}/waiver?booking_id=${row.id}&customer_id=${row.customer_id}`
            : null,

          total_amount: Number(row.total_amount || 0),
          tax_amount: Number(row.tax_amount || 0),
          amount_paid: amountPaid,

          customer_notes: row.customer_notes || null,
          internal_notes: row.internal_notes || null,

          allocation_mode: row.allocation_mode || null,
          bays_allocated:
            row.bays_allocated === null || row.bays_allocated === undefined
              ? null
              : Number(row.bays_allocated),

          tax_exempt: null,
          tax_exempt_reason: null,
          tax_exempt_status: null,
          tax_exempt_form_collected_at: null,

          created_at: row.created_at || null,
        };
      })
      .sort((a, b) => {
        const aTime = a.start_time || "";
        const bTime = b.start_time || "";
        return aTime.localeCompare(bTime);
      });

    const expected = roundMoney(bookings.reduce((sum, b) => sum + b.total_amount, 0));
    const collected = roundMoney(bookings.reduce((sum, b) => sum + b.amount_paid, 0));

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
    console.error(
      "bookings-today failed FULL",
      JSON.stringify(
        {
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
          code: err?.code,
          stack: err?.stack,
          err,
        },
        null,
        2
      )
    );

    return res.status(500).json({ error: err?.message || "Failed to load today bookings" });
  }
}
