import express from "express";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const app = express();

const ALLOWED_ORIGINS = [
  "https://texaxes-ui.vercel.app",
  "https://texaxes-ui-git-main-tim-zlomkes-projects.vercel.app",
  "https://texaxes-ui-git-main-zlomke76-del.vercel.app",
  "http://localhost:3000",
];

/**
 * Deterministic CORS handling for Vercel + browser preflight.
 * This replaces reliance on generic cors() behavior so OPTIONS always exits cleanly.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return next();
});

app.use(express.json());

const PORT = Number(process.env.PORT || 3001);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ======================================================
// CONFIG
// ======================================================
const TOTAL_BAYS = 4;
const PREFERRED_THROWERS_PER_BAY = 4;
const MAX_THROWERS_PER_BAY = 6;
const PUBLIC_MAX_PARTY_SIZE = 24;

const PRICE_PER_THROWER = 29;
const TAX_RATE = 0.0825;

const ADDON_PRICES = {
  byob: 5,
  wktl_knife_rental: 20,
  pro_axe: 10,
  big_axe: 15,
  shovel: 20,
} as const;

const ACTIVE_CAPACITY_STATUSES = [
  "pending",
  "awaiting_payment",
  "paid",
  "confirmed",
  "checked_in",
] as const;

// ======================================================
// TYPES
// ======================================================
type AvailabilityQuery = {
  date?: string;
  throwers?: string;
};

type BookingPayload = {
  date: string;
  time: string;
  throwers: number;
  customer: {
    first_name: string;
    last_name: string;
    email?: string | null;
    phone?: string | null;
    birth_date?: string | null;
    is_minor?: boolean;
    notes?: string | null;
    marketing_opt_in?: boolean;
  };
  addons?: {
    byob_guests?: number;
    wktl_knife_rental_qty?: number;
    pro_axe_qty?: number;
    big_axe_qty?: number;
    shovel_qty?: number;
  };
  booking_source?: "public" | "admin" | "phone" | "walk_in" | "corporate";
  booking_type?: "open" | "league" | "corporate";
  customer_notes?: string;
  internal_notes?: string;
};

type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
};

type TimeBlockRow = {
  id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  is_open: boolean;
  is_bookable: boolean;
};

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

type PricingResult = {
  base_price: number;
  addons_subtotal: number;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  addon_lines: Array<{
    addon_code: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
};

type AdminBookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "paid"
  | "checked_in"
  | "completed"
  | "expired"
  | "no_show";

type AdminPaymentStatus = "pending" | "paid" | "failed" | "void";

type TodayBookingRow = {
  booking_id: string;
  start_time: string;
  end_time: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  party_size: number;
  booking_type: string | null;
  booking_source: string | null;
  booking_status: string;
  payment_status: string;
  waiver_status: string;
  total_amount: number;
  amount_paid: number;
  customer_notes: string | null;
  internal_notes: string | null;
  allocation_mode: string | null;
  bays_allocated: number | null;
  created_at: string | null;
};

type AdminUpdatePayload = {
  booking_id: string;
  booking_status?: AdminBookingStatus;
  payment_status?: AdminPaymentStatus;
  amount_paid?: number;
  internal_notes?: string;
  party_size?: number;
};

// ======================================================
// HELPERS
// ======================================================
function normalizeDate(input: string): string {
  const value = String(input || "").trim();
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }
  return value;
}

function normalizeTime(input: string): string {
  const value = String(input || "").trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    throw new Error("Invalid time");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Invalid time");
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function computeBayRequirements(throwers: number) {
  return {
    preferred: Math.ceil(throwers / PREFERRED_THROWERS_PER_BAY),
    minimum: Math.ceil(throwers / MAX_THROWERS_PER_BAY),
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function getTodayLocalDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function computePricing(payload: BookingPayload): PricingResult {
  const throwers = Number(payload.throwers || 0);
  const addons = payload.addons || {};

  const base_price = roundMoney(throwers * PRICE_PER_THROWER);

  const addon_lines = [
    {
      addon_code: "byob",
      quantity: Number(addons.byob_guests || 0),
      unit_price: ADDON_PRICES.byob,
    },
    {
      addon_code: "wktl_knife_rental",
      quantity: Number(addons.wktl_knife_rental_qty || 0),
      unit_price: ADDON_PRICES.wktl_knife_rental,
    },
    {
      addon_code: "pro_axe",
      quantity: Number(addons.pro_axe_qty || 0),
      unit_price: ADDON_PRICES.pro_axe,
    },
    {
      addon_code: "big_axe",
      quantity: Number(addons.big_axe_qty || 0),
      unit_price: ADDON_PRICES.big_axe,
    },
    {
      addon_code: "shovel",
      quantity: Number(addons.shovel_qty || 0),
      unit_price: ADDON_PRICES.shovel,
    },
  ]
    .filter((line) => line.quantity > 0)
    .map((line) => ({
      ...line,
      line_total: roundMoney(line.quantity * line.unit_price),
    }));

  const addons_subtotal = roundMoney(
    addon_lines.reduce((sum, line) => sum + line.line_total, 0)
  );

  const subtotal = roundMoney(base_price + addons_subtotal);
  const tax_amount = roundMoney(subtotal * TAX_RATE);
  const total_amount = roundMoney(subtotal + tax_amount);

  return {
    base_price,
    addons_subtotal,
    subtotal,
    tax_amount,
    total_amount,
    addon_lines,
  };
}

function deriveWaiverStatus(payload: BookingPayload): "missing" | "guardian_required" {
  const customer = payload.customer;
  if (customer?.is_minor) {
    return "guardian_required";
  }
  return "missing";
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
  actorType: "system" | "admin" | "customer" | "webhook" = "system"
): Promise<void> {
  try {
    await supabase.schema("texaxes").from("audit_log").insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor_type: actorType,
      actor_id: null,
      metadata,
    });
  } catch (error) {
    console.error("audit_log insert failed", error);
  }
}

async function findExistingCustomer(
  email?: string | null,
  phone?: string | null
): Promise<CustomerRow | null> {
  if (email && email.trim()) {
    const normalizedEmail = email.trim().toLowerCase();

    const { data, error } = await supabase
      .schema("texaxes")
      .from("customers")
      .select("id, first_name, last_name, email, phone")
      .ilike("email", normalizedEmail)
      .limit(1)
      .maybeSingle<CustomerRow>();

    if (error) {
      throw error;
    }
    if (data) {
      return data;
    }
  }

  if (phone && phone.trim()) {
    const normalizedPhone = phone.trim();

    const { data, error } = await supabase
      .schema("texaxes")
      .from("customers")
      .select("id, first_name, last_name, email, phone")
      .eq("phone", normalizedPhone)
      .limit(1)
      .maybeSingle<CustomerRow>();

    if (error) {
      throw error;
    }
    if (data) {
      return data;
    }
  }

  return null;
}

async function findOrCreateCustomer(customer: BookingPayload["customer"]): Promise<CustomerRow> {
  const existing = await findExistingCustomer(customer.email, customer.phone);
  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .schema("texaxes")
    .from("customers")
    .insert({
      first_name: customer.first_name.trim(),
      last_name: customer.last_name.trim(),
      email: customer.email?.trim().toLowerCase() || null,
      phone: customer.phone?.trim() || null,
      birth_date: customer.birth_date || null,
      is_minor: Boolean(customer.is_minor),
      notes: customer.notes || null,
      marketing_opt_in: Boolean(customer.marketing_opt_in),
    })
    .select("id, first_name, last_name, email, phone")
    .single<CustomerRow>();

  if (error || !data) {
    throw error || new Error("Customer insert failed");
  }

  return data;
}

async function getTimeBlock(date: string, time: string): Promise<TimeBlockRow | null> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("time_blocks")
    .select("id, block_date, start_time, end_time, is_open, is_bookable")
    .eq("block_date", date)
    .eq("start_time", time)
    .maybeSingle<TimeBlockRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function getCapacityRowsForDate(date: string): Promise<CapacityRow[]> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("v_block_capacity")
    .select(
      "time_block_id, block_date, start_time, end_time, is_open, is_bookable, total_bays, bays_used, bays_open"
    )
    .eq("block_date", date)
    .order("start_time", { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as CapacityRow[];
}

async function getCapacityRowForBlock(timeBlockId: string): Promise<CapacityRow | null> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("v_block_capacity")
    .select(
      "time_block_id, block_date, start_time, end_time, is_open, is_bookable, total_bays, bays_used, bays_open"
    )
    .eq("time_block_id", timeBlockId)
    .maybeSingle<CapacityRow>();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function getAddonCatalogMap(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("addon_catalog")
    .select("id, code")
    .eq("active", true);

  if (error) {
    throw error;
  }

  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.code, row.id);
  }
  return map;
}

async function getLatestPaymentByBookingId(
  bookingId: string
): Promise<{ id: string; status: string | null; amount: number | null } | null> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("payments")
    .select("id, status, amount")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

// ======================================================
// HEALTH
// ======================================================
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ======================================================
// AVAILABILITY
// GET /availability?date=YYYY-MM-DD&throwers=8
// ======================================================
app.get("/availability", async (req, res) => {
  try {
    const { date, throwers } = req.query as AvailabilityQuery;

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

    const rows = await getCapacityRowsForDate(normalizedDate);

    const slots = rows
      .filter((row) => row.is_open && row.is_bookable)
      .map((row) => {
        if (!partySize) {
          let genericState: "available" | "limited" | "full" = "available";
          if (row.bays_open <= 0) {
            genericState = "full";
          } else if (row.bays_open === 1) {
            genericState = "limited";
          }

          return {
            time_block_id: row.time_block_id,
            start: row.start_time.slice(0, 5),
            end: row.end_time.slice(0, 5),
            open_bays: row.bays_open,
            total_bays: row.total_bays,
            state: genericState,
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

    return res.json({
      date: normalizedDate,
      throwers: partySize,
      slots,
    });
  } catch (error) {
    console.error("GET /availability failed", error);
    return res.status(500).json({ error: "Availability failed" });
  }
});

// ======================================================
// ADMIN TODAY BOARD
// GET /api/admin/bookings-today
// ======================================================
app.get("/api/admin/bookings-today", async (req, res) => {
  try {
    const queryDate = req.query.date ? String(req.query.date) : getTodayLocalDate();
    const date = normalizeDate(queryDate);

    const { data: blockRows, error: blockError } = await supabase
      .schema("texaxes")
      .from("time_blocks")
      .select("id, block_date, start_time, end_time")
      .eq("block_date", date)
      .order("start_time", { ascending: true });

    if (blockError) {
      throw blockError;
    }

    const timeBlocks = (blockRows || []) as Array<{
      id: string;
      block_date: string;
      start_time: string;
      end_time: string;
    }>;

    const blockMap = new Map(timeBlocks.map((block) => [block.id, block]));
    const blockIds = timeBlocks.map((block) => block.id);

    if (!blockIds.length) {
      return res.json({
        date,
        summary: {
          booking_count: 0,
          paid_count: 0,
          unpaid_count: 0,
          checked_in_count: 0,
          completed_count: 0,
          expected_revenue: 0,
          collected_revenue: 0,
        },
        bookings: [],
      });
    }

    const { data: bookingRows, error: bookingError } = await supabase
      .schema("texaxes")
      .from("bookings")
      .select(
        "id, customer_id, booking_source, booking_type, status, start_block_id, party_size, bays_allocated, allocation_mode, total_amount, waiver_status, customer_notes, internal_notes, created_at"
      )
      .in("start_block_id", blockIds)
      .order("created_at", { ascending: true });

    if (bookingError) {
      throw bookingError;
    }

    const bookings = bookingRows || [];
    const bookingIds = bookings.map((row) => row.id);
    const customerIds = [
      ...new Set(bookings.map((row) => row.customer_id).filter(Boolean)),
    ];

    const [{ data: customerRows, error: customerError }, { data: paymentRows, error: paymentError }] =
      await Promise.all([
        supabase
          .schema("texaxes")
          .from("customers")
          .select("id, first_name, last_name, email, phone")
          .in("id", customerIds),
        supabase
          .schema("texaxes")
          .from("payments")
          .select("id, booking_id, status, amount, created_at")
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: false }),
      ]);

    if (customerError) {
      throw customerError;
    }

    if (paymentError) {
      throw paymentError;
    }

    const customerMap = new Map(
      (customerRows || []).map((row) => [row.id, row])
    );

    const latestPaymentMap = new Map<
      string,
      { id: string; booking_id: string; status: string | null; amount: number | null; created_at: string | null }
    >();

    for (const row of paymentRows || []) {
      if (!latestPaymentMap.has(row.booking_id)) {
        latestPaymentMap.set(row.booking_id, row);
      }
    }

    const rows: TodayBookingRow[] = bookings
      .map((booking) => {
        const customer = customerMap.get(booking.customer_id);
        const payment = latestPaymentMap.get(booking.id);
        const block = blockMap.get(booking.start_block_id);

        return {
          booking_id: booking.id,
          start_time: block?.start_time || "00:00:00",
          end_time: block?.end_time || "00:00:00",
          customer_name: customer
            ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || "Unknown Customer"
            : "Unknown Customer",
          email: customer?.email || null,
          phone: customer?.phone || null,
          party_size: Number(booking.party_size || 0),
          booking_type: booking.booking_type || null,
          booking_source: booking.booking_source || null,
          booking_status: booking.status || "unknown",
          payment_status: payment?.status || "unknown",
          waiver_status: booking.waiver_status || "unknown",
          total_amount: Number(booking.total_amount || 0),
          amount_paid:
            payment?.status === "paid" ? Number(payment.amount || 0) : 0,
          customer_notes: booking.customer_notes || null,
          internal_notes: booking.internal_notes || null,
          allocation_mode: booking.allocation_mode || null,
          bays_allocated:
            booking.bays_allocated === null || booking.bays_allocated === undefined
              ? null
              : Number(booking.bays_allocated),
          created_at: booking.created_at || null,
        };
      })
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    const summary = {
      booking_count: rows.length,
      paid_count: rows.filter((row) => row.payment_status === "paid").length,
      unpaid_count: rows.filter((row) => row.payment_status !== "paid").length,
      checked_in_count: rows.filter((row) => row.booking_status === "checked_in").length,
      completed_count: rows.filter((row) => row.booking_status === "completed").length,
      expected_revenue: roundMoney(
        rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
      ),
      collected_revenue: roundMoney(
        rows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
      ),
    };

    return res.json({
      date,
      summary,
      bookings: rows,
    });
  } catch (error) {
    console.error("GET /api/admin/bookings-today failed", error);
    return res.status(500).json({ error: "Failed to load today bookings" });
  }
});

// ======================================================
// ADMIN UPDATE BOOKING
// POST /api/admin/update-booking
// ======================================================
app.post("/api/admin/update-booking", async (req, res) => {
  try {
    const payload = req.body as AdminUpdatePayload;

    if (!payload?.booking_id) {
      return res.status(400).json({ error: "Missing booking_id" });
    }

    const bookingUpdates: Record<string, unknown> = {};
    const paymentUpdates: Record<string, unknown> = {};

    if (payload.booking_status) {
      bookingUpdates.status = payload.booking_status;
    }

    if (typeof payload.internal_notes === "string") {
      bookingUpdates.internal_notes = payload.internal_notes;
    }

    if (payload.party_size !== undefined) {
      const size = Number(payload.party_size);
      if (!Number.isInteger(size) || size <= 0) {
        return res.status(400).json({ error: "Invalid party_size" });
      }
      if (size > PUBLIC_MAX_PARTY_SIZE) {
        return res.status(400).json({
          error: "Group too large for public booking. Contact Tex Axes for a full venue booking.",
        });
      }
      bookingUpdates.party_size = size;
    }

    if (payload.payment_status) {
      paymentUpdates.status = payload.payment_status;
      if (payload.payment_status === "paid") {
        paymentUpdates.paid_at = new Date().toISOString();
      }
    }

    if (payload.amount_paid !== undefined) {
      const amount = Number(payload.amount_paid);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({ error: "Invalid amount_paid" });
      }
      paymentUpdates.amount = roundMoney(amount);
    }

    if (Object.keys(bookingUpdates).length > 0) {
      const { error } = await supabase
        .schema("texaxes")
        .from("bookings")
        .update(bookingUpdates)
        .eq("id", payload.booking_id);

      if (error) {
        throw error;
      }
    }

    if (Object.keys(paymentUpdates).length > 0) {
      const paymentRow = await getLatestPaymentByBookingId(payload.booking_id);

      if (paymentRow?.id) {
        const { error } = await supabase
          .schema("texaxes")
          .from("payments")
          .update(paymentUpdates)
          .eq("id", paymentRow.id);

        if (error) {
          throw error;
        }
      }
    }

    await writeAuditLog(
      "booking_admin_updated",
      "booking",
      payload.booking_id,
      {
        booking_id: payload.booking_id,
        booking_updates: bookingUpdates,
        payment_updates: paymentUpdates,
      },
      "admin"
    );

    return res.json({
      success: true,
      booking_id: payload.booking_id,
    });
  } catch (error) {
    console.error("POST /api/admin/update-booking failed", error);
    return res.status(500).json({ error: "Failed to update booking" });
  }
});

// ======================================================
// BOOK
// POST /book
// ======================================================
app.post("/book", async (req, res) => {
  try {
    const payload = req.body as BookingPayload;

    if (!payload?.date || !payload?.time || !payload?.throwers || !payload?.customer) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!payload.customer.first_name?.trim() || !payload.customer.last_name?.trim()) {
      return res.status(400).json({ error: "Customer first and last name are required" });
    }

    const date = normalizeDate(payload.date);
    const time = normalizeTime(payload.time);
    const throwers = Number(payload.throwers);

    if (!Number.isInteger(throwers) || throwers <= 0) {
      return res.status(400).json({ error: "Invalid thrower count" });
    }

    if (throwers > PUBLIC_MAX_PARTY_SIZE) {
      return res.status(400).json({
        error: "Group too large for public booking. Contact Tex Axes for a full venue booking.",
      });
    }

    if (payload.customer.is_minor && payload.customer.birth_date) {
      const birthDate = new Date(`${payload.customer.birth_date}T00:00:00`);
      const bookingDate = new Date(`${date}T00:00:00`);
      const age = bookingDate.getFullYear() - birthDate.getFullYear();
      if (age < 8) {
        return res.status(400).json({
          error: "Guests under 8 are not eligible for standard axe throwing booking.",
        });
      }
    }

    const timeBlock = await getTimeBlock(date, time);
    if (!timeBlock || !timeBlock.is_open || !timeBlock.is_bookable) {
      return res.status(400).json({ error: "Invalid or unavailable time slot" });
    }

    const capacity = await getCapacityRowForBlock(timeBlock.id);
    if (!capacity) {
      return res.status(400).json({ error: "Capacity record not found for slot" });
    }

    const { preferred, minimum } = computeBayRequirements(throwers);

    if (capacity.bays_open < minimum) {
      return res.status(409).json({
        error: "Slot no longer available",
        details: {
          open_bays: capacity.bays_open,
          minimum_bays_required: minimum,
          preferred_bays_required: preferred,
        },
      });
    }

    const allocationMode: "preferred" | "dense" =
      capacity.bays_open >= preferred ? "preferred" : "dense";
    const baysAllocated = allocationMode === "preferred" ? preferred : minimum;

    const customer = await findOrCreateCustomer(payload.customer);
    const pricing = computePricing(payload);
    const waiverStatus = deriveWaiverStatus(payload);
    const bookingSource = payload.booking_source || "public";
    const bookingType = payload.booking_type || "open";

    const { data: booking, error: bookingError } = await supabase
      .schema("texaxes")
      .from("bookings")
      .insert({
        customer_id: customer.id,
        booking_source: bookingSource,
        booking_type: bookingType,
        status: "awaiting_payment",
        start_block_id: timeBlock.id,
        block_count: 1,
        party_size: throwers,
        bays_allocated: baysAllocated,
        allocation_mode: allocationMode,
        base_price: pricing.base_price,
        addons_subtotal: pricing.addons_subtotal,
        subtotal: pricing.subtotal,
        tax_amount: pricing.tax_amount,
        total_amount: pricing.total_amount,
        waiver_status: waiverStatus,
        internal_notes: payload.internal_notes || null,
        customer_notes: payload.customer_notes || null,
        created_by: bookingSource,
      })
      .select()
      .single();

    if (bookingError || !booking) {
      console.error("booking insert failed", bookingError);
      return res.status(500).json({ error: "Booking insert failed" });
    }

    if (pricing.addon_lines.length > 0) {
      const addonMap = await getAddonCatalogMap();

      const addonRows = pricing.addon_lines
        .map((line) => {
          const addonId = addonMap.get(line.addon_code);
          if (!addonId) {
            return null;
          }

          return {
            booking_id: booking.id,
            addon_id: addonId,
            addon_code: line.addon_code,
            quantity: line.quantity,
            unit_price: line.unit_price,
            line_total: line.line_total,
          };
        })
        .filter(Boolean);

      if (addonRows.length > 0) {
        const { error: addonInsertError } = await supabase
          .schema("texaxes")
          .from("booking_addons")
          .insert(addonRows as any[]);

        if (addonInsertError) {
          console.error("booking_addons insert failed", addonInsertError);
          return res.status(500).json({ error: "Booking add-on insert failed" });
        }
      }
    }

    const { data: paymentRow, error: paymentInsertError } = await supabase
      .schema("texaxes")
      .from("payments")
      .insert({
        booking_id: booking.id,
        payment_provider: "stripe",
        payment_type: "full",
        status: "pending",
        amount: pricing.total_amount,
        currency: "usd",
      })
      .select()
      .single();

    if (paymentInsertError || !paymentRow) {
      console.error("payments insert failed", paymentInsertError);
      return res.status(500).json({ error: "Payment record insert failed" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: customer.email || undefined,
      metadata: {
        booking_id: booking.id,
        payment_id: paymentRow.id,
        customer_id: customer.id,
        booking_source: bookingSource,
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tex Axes Booking",
              description: `${date} ${time.slice(0, 5)} · ${throwers} thrower(s)`,
            },
            unit_amount: Math.round(pricing.total_amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${FRONTEND_URL}/success?booking_id=${booking.id}`,
      cancel_url: `${FRONTEND_URL}/cancel?booking_id=${booking.id}`,
    });

    const { error: bookingUpdateError } = await supabase
      .schema("texaxes")
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", booking.id);

    if (bookingUpdateError) {
      console.error("booking update failed", bookingUpdateError);
      return res.status(500).json({ error: "Booking session update failed" });
    }

    const { error: paymentUpdateError } = await supabase
      .schema("texaxes")
      .from("payments")
      .update({
        external_checkout_id: session.id,
      })
      .eq("id", paymentRow.id);

    if (paymentUpdateError) {
      console.error("payment update failed", paymentUpdateError);
      return res.status(500).json({ error: "Payment session update failed" });
    }

    await writeAuditLog("booking_created", "booking", booking.id, {
      booking_id: booking.id,
      customer_id: customer.id,
      time_block_id: timeBlock.id,
      party_size: throwers,
      bays_allocated: baysAllocated,
      allocation_mode: allocationMode,
      total_amount: pricing.total_amount,
      booking_source: bookingSource,
    });

    return res.json({
      booking_id: booking.id,
      checkout_url: session.url,
      totals: {
        base_price: pricing.base_price,
        addons_subtotal: pricing.addons_subtotal,
        subtotal: pricing.subtotal,
        tax_amount: pricing.tax_amount,
        total_amount: pricing.total_amount,
      },
      allocation: {
        mode: allocationMode,
        bays_allocated: baysAllocated,
        preferred_bays_required: preferred,
        minimum_bays_required: minimum,
      },
    });
  } catch (error) {
    console.error("POST /book failed", error);
    return res.status(500).json({ error: "Booking failed" });
  }
});

app.listen(PORT, () => {
  console.log(`Tex Axes Ops running on ${PORT}`);
});
