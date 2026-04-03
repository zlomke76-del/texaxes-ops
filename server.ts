import express from "express";
import Stripe from "stripe";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { buildBookingCustomerEmail } from "@/lib/email/bookingCustomer";
import { buildBookingInternalEmail } from "@/lib/email/bookingInternal";
import { buildWaiverEmail } from "@/lib/email/waiver";
import { buildThankYouEmail } from "@/lib/email/thankYou";
import { buildMarketingEmail } from "@/lib/email/marketing";

const app = express();

const ALLOWED_ORIGINS = [
  "https://www.texaxes.com",
  "https://texaxes.com",
  "https://book.texaxes.com",
  "https://texaxes-ui.vercel.app",
  "https://texaxes-ui-git-main-tim-zlomkes-projects.vercel.app",
  "https://texaxes-ui-git-main-zlomke76-del.vercel.app",
  "https://texaxes-booking-ui.vercel.app",
  "https://zlomke76-del-texaxes-booking-ui.vercel.app",
  "http://localhost:3000",
];

// ======================================================
// CORS
// ======================================================
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, stripe-signature");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return next();
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const WAIVER_FROM_EMAIL =
  process.env.WAIVER_FROM_EMAIL || "Tex Axes <onboarding@resend.dev>";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-06-20",
    })
  : null;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

// ======================================================
// CONFIG
// ======================================================
const PREFERRED_THROWERS_PER_BAY = 4;
const MAX_THROWERS_PER_BAY = 6;
const PUBLIC_MAX_PARTY_SIZE = 24;

const PRICE_PER_THROWER = 29;
const TAX_RATE = 0.0825;

// ======================================================
// TYPES
// ======================================================
type AvailabilityQuery = {
  date?: string;
  throwers?: string;
};

type BaseCustomerPayload = {
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  birth_date?: string | null;
  is_minor?: boolean;
  notes?: string | null;
  marketing_opt_in?: boolean;
};

type BookingPayload = {
  date: string;
  time: string;
  throwers: number;
  customer: BaseCustomerPayload;
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

type AdminCreateBookingPayload = {
  date: string;
  time: string;
  throwers: number;
  customer: BaseCustomerPayload;
  booking_source?: "admin" | "phone" | "walk_in" | "corporate";
  booking_type?: "open" | "league" | "corporate";
  customer_notes?: string;
  internal_notes?: string;
  payment_status?: "pending" | "paid";
  tax_exempt?: boolean;
  tax_exempt_reason?: string | null;
  tax_exempt_status?: "pending_form" | "verified" | null;
};

type WaiverSignPayload = {
  booking_id?: string | null;
  customer: BaseCustomerPayload;
  is_minor?: boolean;
  guardian?: BaseCustomerPayload | null;
  signature_data_url: string;
  signature_method?: string;
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
  customer_id: string;
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
  waiver_status: "complete" | "partial" | "missing" | "guardian_required" | "expired";
  waiver_required: number;
  waiver_signed: number;
  waiver_url: string;
  total_amount: number;
  tax_amount: number;
  amount_paid: number;
  customer_notes: string | null;
  internal_notes: string | null;
  allocation_mode: string | null;
  bays_allocated: number | null;
  created_at: string | null;
  tax_exempt: boolean | null;
  tax_exempt_reason: string | null;
  tax_exempt_status: string | null;
  tax_exempt_form_collected_at: string | null;
};

type AdminUpdatePayload = {
  booking_id: string;
  booking_status?: AdminBookingStatus;
  payment_status?: AdminPaymentStatus;
  amount_paid?: number;
  internal_notes?: string;
  party_size?: number;
  tax_exempt_status?: "pending_form" | "verified" | null;
};

type WaiverEmailResult = {
  sent: boolean;
  error: string | null;
};

type TabType = "booking" | "walk_in" | "spectator" | "retail_only";
type TabStatus = "open" | "closed" | "void";
type TabItemType = "booking" | "drink" | "snack" | "retail" | "axe" | "custom";
type TabPaymentMethod =
  | "online_stripe"
  | "in_store_terminal"
  | "cash"
  | "comp"
  | "manual_adjustment";

type CreateTabPayload = {
  booking_id?: string | null;
  customer_id?: string | null;
  tab_type: TabType;
  status?: TabStatus;
  party_name?: string | null;
  party_size?: number;
  notes?: string | null;
};

type AddLineItemPayload = {
  tab_id: string;
  item_type: TabItemType;
  description: string;
  quantity?: number;
  unit_price: number;
  taxable?: boolean;
  tax_rate?: number;
  tax_exempt_override?: boolean;
  tax_exempt_reason?: string | null;
  note?: string | null;
};

type AddPaymentPayload = {
  tab_id: string;
  amount: number;
  payment_method: TabPaymentMethod;
  status?: "pending" | "completed" | "void";
  reference?: string | null;
  note?: string | null;
  collected_by?: string | null;
};

type UpdateTabStatusPayload = {
  tab_id: string;
  status: TabStatus;
  note?: string | null;
};

type VoidLineItemPayload = {
  line_item_id: string;
  note?: string | null;
};

type VoidPaymentPayload = {
  payment_id: string;
  note?: string | null;
};

type TabRow = {
  id: string;
  booking_id: string | null;
  customer_id: string | null;
  tab_type: TabType;
  status: TabStatus;
  party_name: string | null;
  party_size: number;
  notes: string | null;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  opened_at: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TabLineItemRow = {
  id: string;
  tab_id: string;
  item_type: TabItemType;
  description: string;
  quantity: number;
  unit_price: number;
  taxable: boolean;
  tax_rate: number;
  tax_exempt_override: boolean;
  tax_exempt_reason: string | null;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TabPaymentRow = {
  id: string;
  tab_id: string;
  payment_method: TabPaymentMethod;
  status: "pending" | "completed" | "void";
  amount: number;
  reference: string | null;
  note: string | null;
  collected_by: string | null;
  created_at: string | null;
  updated_at: string | null;
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

  const addonPrices = {
    byob: 5,
    wktl_knife_rental: 20,
    pro_axe: 10,
    big_axe: 15,
    shovel: 20,
  } as const;

  const base_price = roundMoney(throwers * PRICE_PER_THROWER);

  const addon_lines = [
    {
      addon_code: "byob",
      quantity: Number(addons.byob_guests || 0),
      unit_price: addonPrices.byob,
    },
    {
      addon_code: "wktl_knife_rental",
      quantity: Number(addons.wktl_knife_rental_qty || 0),
      unit_price: addonPrices.wktl_knife_rental,
    },
    {
      addon_code: "pro_axe",
      quantity: Number(addons.pro_axe_qty || 0),
      unit_price: addonPrices.pro_axe,
    },
    {
      addon_code: "big_axe",
      quantity: Number(addons.big_axe_qty || 0),
      unit_price: addonPrices.big_axe,
    },
    {
      addon_code: "shovel",
      quantity: Number(addons.shovel_qty || 0),
      unit_price: addonPrices.shovel,
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

function deriveInitialWaiverStatus(
  payload: BookingPayload
): "missing" | "guardian_required" {
  const customer = payload.customer;
  if (customer?.is_minor) {
    return "guardian_required";
  }
  return "missing";
}

function buildWaiverUrl(bookingId: string, customerId: string): string {
  const base = FRONTEND_URL.replace(/\/+$/, "");
  return `${base}/waiver?booking_id=${encodeURIComponent(
    bookingId
  )}&customer_id=${encodeURIComponent(customerId)}`;
}

function normalizeTabType(value?: string | null): TabType {
  if (
    value === "booking" ||
    value === "walk_in" ||
    value === "spectator" ||
    value === "retail_only"
  ) {
    return value;
  }
  throw new Error("Invalid tab_type");
}

function normalizeTabStatus(value?: string | null): TabStatus {
  if (value === "open" || value === "closed" || value === "void") {
    return value;
  }
  throw new Error("Invalid status");
}

function normalizePaymentMethod(value?: string | null): TabPaymentMethod {
  if (
    value === "online_stripe" ||
    value === "in_store_terminal" ||
    value === "cash" ||
    value === "comp" ||
    value === "manual_adjustment"
  ) {
    return value;
  }
  throw new Error("Invalid payment_method");
}

function normalizeTabItemType(value?: string | null): TabItemType {
  if (
    value === "booking" ||
    value === "drink" ||
    value === "snack" ||
    value === "retail" ||
    value === "axe" ||
    value === "custom"
  ) {
    return value;
  }
  throw new Error("Invalid item_type");
}

function appendNote(existing: string | null | undefined, line: string): string {
  const trimmed = (existing || "").trim();
  if (!trimmed) return line;
  return `${trimmed}\n${line}`;
}

async function sendWaiverEmail(params: {
  to: string | null | undefined;
  firstName: string;
  waiverUrl: string;
  bookingDate?: string;
  bookingTime?: string;
}): Promise<WaiverEmailResult> {
  try {
    if (!params.to || !params.to.trim()) {
      return { sent: false, error: "missing_email" };
    }

    if (!resend) {
      return { sent: false, error: "resend_not_configured" };
    }

    const email = buildWaiverEmail({
      firstName: params.firstName,
      waiverUrl: params.waiverUrl,
      bookingDate: params.bookingDate,
      bookingTime: params.bookingTime,
    });

    const { error } = await resend.emails.send({
      from: WAIVER_FROM_EMAIL,
      to: params.to.trim(),
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (error) {
      return { sent: false, error: error.message || "resend_send_failed" };
    }

    return { sent: true, error: null };
  } catch (error: any) {
    return {
      sent: false,
      error: error?.message || "waiver_email_failed",
    };
  }
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

    if (error) throw error;
    if (data) return data;
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

    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function findOrCreateCustomer(customer: BaseCustomerPayload): Promise<CustomerRow> {
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

  if (error) throw error;
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

  if (error) throw error;
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

  if (error) throw error;
  return data ?? null;
}

async function getAddonCatalogMap(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("addon_catalog")
    .select("id, code")
    .eq("active", true);

  if (error) throw error;

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

  if (error) throw error;
  return data ?? null;
}

async function getWaiverSummaryForBooking(
  _bookingId: string,
  customerId: string,
  bookingDate: string,
  partySize: number
): Promise<{
  waiver_status: "complete" | "partial" | "missing" | "guardian_required" | "expired";
  waiver_required: number;
  waiver_signed: number;
}> {
  const required = Math.max(1, Number(partySize || 1));

  const { data, error } = await supabase
    .schema("texaxes")
    .from("waivers")
    .select("expires_at, is_minor, parent_customer_id")
    .eq("customer_id", customerId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return {
      waiver_status: "missing",
      waiver_required: required,
      waiver_signed: 0,
    };
  }

  const booking = new Date(`${bookingDate}T00:00:00`);
  const expiry = new Date(data.expires_at);

  if (expiry < booking) {
    return {
      waiver_status: "expired",
      waiver_required: required,
      waiver_signed: 0,
    };
  }

  if (data.is_minor && !data.parent_customer_id) {
    return {
      waiver_status: "guardian_required",
      waiver_required: required,
      waiver_signed: 0,
    };
  }

  return {
    waiver_status: required > 1 ? "partial" : "complete",
    waiver_required: required,
    waiver_signed: 1,
  };
}

async function recalculateTabTotals(tabId: string): Promise<TabRow> {
  const { data: items, error: itemsError } = await supabase
    .schema("texaxes")
    .from("tab_line_items")
    .select("line_subtotal, line_tax, line_total")
    .eq("tab_id", tabId);

  if (itemsError) throw itemsError;

  const { data: payments, error: paymentsError } = await supabase
    .schema("texaxes")
    .from("tab_payments")
    .select("amount, status")
    .eq("tab_id", tabId);

  if (paymentsError) throw paymentsError;

  const subtotal = roundMoney(
    (items || []).reduce((sum, row: any) => sum + Number(row.line_subtotal || 0), 0)
  );
  const tax_total = roundMoney(
    (items || []).reduce((sum, row: any) => sum + Number(row.line_tax || 0), 0)
  );
  const grand_total = roundMoney(
    (items || []).reduce((sum, row: any) => sum + Number(row.line_total || 0), 0)
  );
  const amount_paid = roundMoney(
    (payments || [])
      .filter((row: any) => row.status === "completed")
      .reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
  );
  const balance_due = roundMoney(Math.max(grand_total - amount_paid, 0));

  const { data: tab, error: updateError } = await supabase
    .schema("texaxes")
    .from("tabs")
    .update({
      subtotal,
      tax_total,
      grand_total,
      amount_paid,
      balance_due,
    })
    .eq("id", tabId)
    .select("*")
    .single<TabRow>();

  if (updateError || !tab) {
    throw updateError || new Error("Tab totals update failed");
  }

  return {
    ...tab,
    subtotal: Number(tab.subtotal || 0),
    tax_total: Number(tab.tax_total || 0),
    grand_total: Number(tab.grand_total || 0),
    amount_paid: Number(tab.amount_paid || 0),
    balance_due: Number(tab.balance_due || 0),
    party_size: Number(tab.party_size || 1),
  };
}

async function loadTabById(tabId: string) {
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
    throw tabError || new Error("Tab not found");
  }

  const { data: lineItems, error: lineItemsError } = await supabase
    .schema("texaxes")
    .from("tab_line_items")
    .select("*")
    .eq("tab_id", tabId)
    .order("created_at", { ascending: true });

  if (lineItemsError) throw lineItemsError;

  const { data: payments, error: paymentsError } = await supabase
    .schema("texaxes")
    .from("tab_payments")
    .select("*")
    .eq("tab_id", tabId)
    .order("created_at", { ascending: true });

  if (paymentsError) throw paymentsError;

  return {
    tab: {
      ...tab,
      subtotal: Number((tab as any).subtotal || 0),
      tax_total: Number((tab as any).tax_total || 0),
      grand_total: Number((tab as any).grand_total || 0),
      amount_paid: Number((tab as any).amount_paid || 0),
      balance_due: Number((tab as any).balance_due || 0),
      party_size: Number((tab as any).party_size || 1),
    },
    line_items: (lineItems || []).map((row: any) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      unit_price: Number(row.unit_price || 0),
      line_subtotal: Number(row.line_subtotal || 0),
      line_tax: Number(row.line_tax || 0),
      line_total: Number(row.line_total || 0),
      tax_rate: Number(row.tax_rate || 0),
    })),
    payments: (payments || []).map((row: any) => ({
      ...row,
      amount: Number(row.amount || 0),
    })),
  };
}

// ======================================================
// STRIPE WEBHOOK HELPERS
// ======================================================
async function markBookingPaid(
  bookingId: string,
  paymentId: string | null,
  paymentIntentId: string,
  checkoutSessionId: string | null,
  amountReceivedCents: number
): Promise<void> {
  const amountReceived = amountReceivedCents / 100;
  const paidAtIso = new Date().toISOString();

  if (paymentId) {
    const { error: paymentError } = await supabase
      .schema("texaxes")
      .from("payments")
      .update({
        status: "paid",
        external_payment_id: paymentIntentId,
        external_checkout_id: checkoutSessionId,
        paid_at: paidAtIso,
        amount: amountReceived,
      })
      .eq("id", paymentId)
      .neq("status", "paid");

    if (paymentError) {
      throw paymentError;
    }
  } else {
    const { data: paymentRow, error: paymentLookupError } = await supabase
      .schema("texaxes")
      .from("payments")
      .select("id, status")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentLookupError) {
      throw paymentLookupError;
    }

    if (paymentRow?.id && paymentRow.status !== "paid") {
      const { error: paymentUpdateError } = await supabase
        .schema("texaxes")
        .from("payments")
        .update({
          status: "paid",
          external_payment_id: paymentIntentId,
          external_checkout_id: checkoutSessionId,
          paid_at: paidAtIso,
          amount: amountReceived,
        })
        .eq("id", paymentRow.id);

      if (paymentUpdateError) {
        throw paymentUpdateError;
      }
    }
  }

  const { error: bookingError } = await supabase
    .schema("texaxes")
    .from("bookings")
    .update({
      status: "paid",
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
    })
    .eq("id", bookingId)
    .in("status", ["pending", "awaiting_payment", "confirmed"]);

  if (bookingError) {
    throw bookingError;
  }

  const { data: paidBooking, error: paidBookingLookupError } = await supabase
    .schema("texaxes")
    .from("bookings")
    .select("id, offer_code")
    .eq("id", bookingId)
    .maybeSingle();

  if (paidBookingLookupError) {
    throw paidBookingLookupError;
  }

  if (paidBooking?.offer_code) {
    const { error: offerRedeemError } = await supabase
      .schema("texaxes")
      .from("customer_offers")
      .update({
        status: "redeemed",
        redeemed_at: paidAtIso,
        redeemed_booking_id: bookingId,
      })
      .eq("code", paidBooking.offer_code)
      .eq("status", "active");

    if (offerRedeemError) {
      throw offerRedeemError;
    }
  }

  await writeAuditLog(
    "booking_paid",
    "booking",
    bookingId,
    {
      booking_id: bookingId,
      payment_id: paymentId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
      amount_received_cents: amountReceivedCents,
      offer_code: paidBooking?.offer_code || null,
    },
    "webhook"
  );
}

async function markLeagueRegistrationPaid(
  registrationId: string,
  paymentIntentId: string,
  checkoutSessionId: string | null,
  amountReceivedCents: number
): Promise<void> {
  const amountReceived = amountReceivedCents / 100;

  const { error } = await supabase
    .schema("texaxes")
    .from("league_registrations")
    .update({
      status: "paid",
      payment_status: "paid",
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
      paid_at: new Date().toISOString(),
      total_amount_paid: amountReceived,
    })
    .eq("id", registrationId)
    .in("status", ["pending", "awaiting_payment"]);

  if (error) {
    throw error;
  }

  await writeAuditLog(
    "league_registration_paid",
    "league_registration",
    registrationId,
    {
      league_registration_id: registrationId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
      amount_received_cents: amountReceivedCents,
    },
    "webhook"
  );
}

async function markPaymentFailed(
  bookingId: string | null,
  paymentId: string | null,
  paymentIntentId: string,
  checkoutSessionId: string | null,
  lastPaymentError: string | null
): Promise<void> {
  if (paymentId) {
    const { error: paymentError } = await supabase
      .schema("texaxes")
      .from("payments")
      .update({
        status: "failed",
        external_payment_id: paymentIntentId,
        external_checkout_id: checkoutSessionId,
      })
      .eq("id", paymentId)
      .neq("status", "paid");

    if (paymentError) {
      throw paymentError;
    }
  }

  if (bookingId) {
    await writeAuditLog(
      "payment_failed",
      "booking",
      bookingId,
      {
        booking_id: bookingId,
        payment_id: paymentId,
        stripe_payment_intent_id: paymentIntentId,
        stripe_checkout_session_id: checkoutSessionId,
        error: lastPaymentError,
      },
      "webhook"
    );
  }
}

async function markLeagueRegistrationFailed(
  registrationId: string | null,
  paymentIntentId: string,
  checkoutSessionId: string | null,
  lastPaymentError: string | null
): Promise<void> {
  if (!registrationId) return;

  const { error } = await supabase
    .schema("texaxes")
    .from("league_registrations")
    .update({
      payment_status: "failed",
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
    })
    .eq("id", registrationId)
    .neq("payment_status", "paid");

  if (error) {
    throw error;
  }

  await writeAuditLog(
    "league_payment_failed",
    "league_registration",
    registrationId,
    {
      league_registration_id: registrationId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
      error: lastPaymentError,
    },
    "webhook"
  );
}

async function expireUnpaidBooking(
  bookingId: string,
  paymentId: string | null,
  checkoutSessionId: string
): Promise<void> {
  const { error: bookingError } = await supabase
    .schema("texaxes")
    .from("bookings")
    .update({
      status: "expired",
    })
    .eq("id", bookingId)
    .in("status", ["pending", "awaiting_payment"]);

  if (bookingError) {
    throw bookingError;
  }

  if (paymentId) {
    const { error: paymentError } = await supabase
      .schema("texaxes")
      .from("payments")
      .update({
        status: "void",
        external_checkout_id: checkoutSessionId,
      })
      .eq("id", paymentId)
      .neq("status", "paid");

    if (paymentError) {
      throw paymentError;
    }
  }

  await writeAuditLog(
    "booking_expired",
    "booking",
    bookingId,
    {
      booking_id: bookingId,
      payment_id: paymentId,
      stripe_checkout_session_id: checkoutSessionId,
    },
    "webhook"
  );
}

async function expireUnpaidLeagueRegistration(
  registrationId: string,
  checkoutSessionId: string
): Promise<void> {
  const { error } = await supabase
    .schema("texaxes")
    .from("league_registrations")
    .update({
      status: "expired",
      payment_status: "void",
      stripe_checkout_session_id: checkoutSessionId,
    })
    .eq("id", registrationId)
    .in("status", ["pending", "awaiting_payment"]);

  if (error) {
    throw error;
  }

  await writeAuditLog(
    "league_registration_expired",
    "league_registration",
    registrationId,
    {
      league_registration_id: registrationId,
      stripe_checkout_session_id: checkoutSessionId,
    },
    "webhook"
  );
}

// ======================================================
// STRIPE WEBHOOK
// IMPORTANT: MUST BE REGISTERED BEFORE express.json()
// ======================================================
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) {
      return res.status(500).send("Stripe is not configured");
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      return res.status(400).send("Missing stripe-signature header");
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!webhookSecret) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
    }

    try {
      const rawBody = req.body as Buffer;

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch (err: any) {
        console.error("Stripe webhook signature verification failed", err);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;

          const bookingId = session.metadata?.booking_id || null;
          const leagueRegistrationId = session.metadata?.league_registration_id || null;
          const paymentId = session.metadata?.payment_id || null;

          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || null;

          if (!paymentIntentId) {
            return res.status(400).send("Missing payment intent");
          }

          if (bookingId) {
            await markBookingPaid(
              bookingId,
              paymentId,
              paymentIntentId,
              session.id,
              session.amount_total || 0
            );
          }

          if (leagueRegistrationId) {
            await markLeagueRegistrationPaid(
              leagueRegistrationId,
              paymentIntentId,
              session.id,
              session.amount_total || 0
            );
          }

          if (!bookingId && !leagueRegistrationId) {
            return res.status(400).send("Missing booking or league registration metadata");
          }

          break;
        }

        case "payment_intent.succeeded": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          const bookingId = paymentIntent.metadata?.booking_id || null;
          const leagueRegistrationId = paymentIntent.metadata?.league_registration_id || null;
          const paymentId = paymentIntent.metadata?.payment_id || null;

          if (bookingId) {
            await markBookingPaid(
              bookingId,
              paymentId,
              paymentIntent.id,
              null,
              paymentIntent.amount_received || paymentIntent.amount || 0
            );
          }

          if (leagueRegistrationId) {
            await markLeagueRegistrationPaid(
              leagueRegistrationId,
              paymentIntent.id,
              null,
              paymentIntent.amount_received || paymentIntent.amount || 0
            );
          }

          break;
        }

        case "payment_intent.payment_failed": {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          const bookingId = paymentIntent.metadata?.booking_id || null;
          const leagueRegistrationId = paymentIntent.metadata?.league_registration_id || null;
          const paymentId = paymentIntent.metadata?.payment_id || null;
          const message = paymentIntent.last_payment_error?.message || null;

          await markPaymentFailed(bookingId, paymentId, paymentIntent.id, null, message);
          await markLeagueRegistrationFailed(
            leagueRegistrationId,
            paymentIntent.id,
            null,
            message
          );
          break;
        }

        case "checkout.session.expired": {
          const session = event.data.object as Stripe.Checkout.Session;

          const bookingId = session.metadata?.booking_id || null;
          const leagueRegistrationId = session.metadata?.league_registration_id || null;
          const paymentId = session.metadata?.payment_id || null;

          if (bookingId) {
            await expireUnpaidBooking(bookingId, paymentId, session.id);
          }

          if (leagueRegistrationId) {
            await expireUnpaidLeagueRegistration(leagueRegistrationId, session.id);
          }

          break;
        }

        default:
          break;
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error("Stripe webhook failed", error);
      return res.status(500).send("Webhook handler failed");
    }
  }
);

// IMPORTANT: JSON parsing comes after Stripe webhook route
app.use(express.json({ limit: "10mb" }));

// ======================================================
// HEALTH
// ======================================================
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ======================================================
// AVAILABILITY
// ======================================================
app.get("/api/availability", async (req, res) => {
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
          error:
            "Group too large for public booking. Contact Tex Axes for a full venue booking.",
        });
      }
    }

    const rows = await getCapacityRowsForDate(normalizedDate);

    const slots = rows
      .filter((row) => row.is_open && row.is_bookable)
      .map((row) => {
        if (!partySize) {
          let genericState: "available" | "limited" | "full" = "available";
          if (row.bays_open <= 0) genericState = "full";
          else if (row.bays_open === 1) genericState = "limited";

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
        if (row.bays_open >= preferred) state = "available";
        else if (row.bays_open >= minimum) state = "limited";
        else state = "full";

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
// WAIVER SIGN
// ======================================================
app.post("/api/waivers/sign", async (req, res) => {
  try {
    const {
      customer,
      is_minor,
      guardian,
      signature_data_url,
      signature_method = "electronic",
      booking_id,
    } = req.body as WaiverSignPayload;

    if (!customer?.first_name || !customer?.last_name) {
      return res.status(400).json({ error: "Customer name required" });
    }

    if (!signature_data_url) {
      return res.status(400).json({ error: "Signature required" });
    }

    const customerRow = await findOrCreateCustomer({
      ...customer,
      is_minor: Boolean(is_minor),
    });

    let guardianCustomerId: string | null = null;

    if (is_minor) {
      if (!guardian?.first_name || !guardian?.last_name) {
        return res.status(400).json({ error: "Guardian required for minor" });
      }

      const guardianRow = await findOrCreateCustomer({
        ...guardian,
        is_minor: false,
      });

      guardianCustomerId = guardianRow.id;
    }

    const signedAt = new Date();
    const expiresAt = new Date(signedAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const waiverVersionHash = "v1";

    const insertPayload: Record<string, unknown> = {
      customer_id: customerRow.id,
      waiver_version_hash: waiverVersionHash,
      signed_at: signedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      signature_method,
      ip_address: req.ip || null,
      user_agent: req.headers["user-agent"] || null,
      is_minor: Boolean(is_minor),
      parent_customer_id: guardianCustomerId,
    };

    if (booking_id) {
      insertPayload.booking_id = booking_id;
    }

    const { data: waiver, error } = await supabase
      .schema("texaxes")
      .from("waivers")
      .insert(insertPayload)
      .select()
      .single();

    if (error || !waiver) {
      throw error || new Error("Waiver insert failed");
    }

    await writeAuditLog(
      "waiver_signed",
      "waiver",
      waiver.id,
      {
        customer_id: customerRow.id,
        parent_customer_id: guardianCustomerId,
        booking_id: booking_id || null,
        is_minor: Boolean(is_minor),
      },
      "customer"
    );

    return res.json({
      success: true,
      waiver_id: waiver.id,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("POST /api/waivers/sign failed", error);
    return res.status(500).json({ error: "Waiver signing failed" });
  }
});

// ======================================================
// ADMIN DATE BOARD
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

    if (blockError) throw blockError;

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
          waiver_complete_count: 0,
          waiver_partial_count: 0,
          waiver_missing_count: 0,
        },
        bookings: [],
      });
    }

    const { data: bookingRows, error: bookingError } = await supabase
      .schema("texaxes")
      .from("bookings")
      .select(
        "id, customer_id, booking_source, booking_type, status, start_block_id, party_size, bays_allocated, allocation_mode, total_amount, tax_amount, customer_notes, internal_notes, created_at"
      )
      .in("start_block_id", blockIds)
      .order("created_at", { ascending: true });

    if (bookingError) throw bookingError;

    const bookings = bookingRows || [];

    if (!bookings.length) {
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
          waiver_complete_count: 0,
          waiver_partial_count: 0,
          waiver_missing_count: 0,
        },
        bookings: [],
      });
    }

    const bookingIds = bookings.map((row) => row.id);
    const customerIds = [...new Set(bookings.map((row) => row.customer_id).filter(Boolean))];

    const [
      { data: customerRows, error: customerError },
      { data: paymentRows, error: paymentError },
    ] = await Promise.all([
      customerIds.length
        ? supabase
            .schema("texaxes")
            .from("customers")
            .select("id, first_name, last_name, email, phone")
            .in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      bookingIds.length
        ? supabase
            .schema("texaxes")
            .from("payments")
            .select("id, booking_id, status, amount, created_at")
            .in("booking_id", bookingIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (customerError) throw customerError;
    if (paymentError) throw paymentError;

    const customerMap = new Map((customerRows || []).map((row) => [row.id, row]));

    const latestPaymentMap = new Map<
      string,
      {
        id: string;
        booking_id: string;
        status: string | null;
        amount: number | null;
        created_at: string | null;
      }
    >();

    for (const row of paymentRows || []) {
      if (!latestPaymentMap.has(row.booking_id)) {
        latestPaymentMap.set(row.booking_id, row);
      }
    }

    const rows: TodayBookingRow[] = await Promise.all(
      bookings.map(async (booking: any) => {
        const customer = customerMap.get(booking.customer_id);
        const payment = latestPaymentMap.get(booking.id);
        const block = blockMap.get(booking.start_block_id);
        const waiverSummary = await getWaiverSummaryForBooking(
          booking.id,
          booking.customer_id,
          date,
          Number(booking.party_size || 1)
        );

        return {
          booking_id: booking.id,
          customer_id: booking.customer_id,
          start_time: block?.start_time || "00:00:00",
          end_time: block?.end_time || "00:00:00",
          customer_name: customer
            ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim() ||
              "Unknown Customer"
            : "Unknown Customer",
          email: customer?.email || null,
          phone: customer?.phone || null,
          party_size: Number(booking.party_size || 0),
          booking_type: booking.booking_type || null,
          booking_source: booking.booking_source || null,
          booking_status: booking.status || "unknown",
          payment_status: payment?.status || "pending",
          waiver_status: waiverSummary.waiver_status,
          waiver_required: waiverSummary.waiver_required,
          waiver_signed: waiverSummary.waiver_signed,
          waiver_url: buildWaiverUrl(booking.id, booking.customer_id),
          total_amount: Number(booking.total_amount || 0),
          tax_amount: Number(booking.tax_amount || 0),
          amount_paid: payment?.status === "paid" ? Number(payment.amount || 0) : 0,
          customer_notes: booking.customer_notes || null,
          internal_notes: booking.internal_notes || null,
          allocation_mode: booking.allocation_mode || null,
          bays_allocated:
            booking.bays_allocated === null || booking.bays_allocated === undefined
              ? null
              : Number(booking.bays_allocated),
          created_at: booking.created_at || null,
          tax_exempt: null,
          tax_exempt_reason: null,
          tax_exempt_status: null,
          tax_exempt_form_collected_at: null,
        };
      })
    );

    const sortedRows = rows.sort((a, b) => a.start_time.localeCompare(b.start_time));

    const summary = {
      booking_count: sortedRows.length,
      paid_count: sortedRows.filter((row) => row.payment_status === "paid").length,
      unpaid_count: sortedRows.filter((row) => row.payment_status !== "paid").length,
      checked_in_count: sortedRows.filter((row) => row.booking_status === "checked_in").length,
      completed_count: sortedRows.filter((row) => row.booking_status === "completed").length,
      expected_revenue: roundMoney(
        sortedRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0)
      ),
      collected_revenue: roundMoney(
        sortedRows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0)
      ),
      waiver_complete_count: sortedRows.filter((row) => row.waiver_status === "complete").length,
      waiver_partial_count: sortedRows.filter((row) => row.waiver_status === "partial").length,
      waiver_missing_count: sortedRows.filter((row) => row.waiver_status === "missing").length,
    };

    return res.json({
      date,
      summary,
      bookings: sortedRows,
    });
  } catch (error) {
    console.error("GET /api/admin/bookings-today failed", error);
    return res.status(500).json({ error: "Failed to load today bookings" });
  }
});

// ======================================================
// ADMIN CREATE BOOKING
// ======================================================
app.post("/api/admin/create-booking", async (req, res) => {
  try {
    const payload = req.body as AdminCreateBookingPayload;

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
        error:
          "Group too large for public booking. Contact Tex Axes for a full venue booking.",
      });
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

    const bookingSource = payload.booking_source || "admin";
    const bookingType = payload.booking_type || "open";
    const paymentStatus = payload.payment_status || "pending";

    const customer = await findOrCreateCustomer(payload.customer);
    const pricing = computePricing({
      ...payload,
      booking_source: bookingSource,
      booking_type: bookingType,
    } as BookingPayload);

    const waiverStatus = deriveInitialWaiverStatus({
      ...payload,
      booking_source: bookingSource,
      booking_type: bookingType,
    } as BookingPayload);

    const bookingStatus: AdminBookingStatus =
      paymentStatus === "paid" ? "paid" : "confirmed";

    const { data: booking, error: bookingError } = await supabase
      .schema("texaxes")
      .from("bookings")
      .insert({
        customer_id: customer.id,
        booking_source: bookingSource,
        booking_type: bookingType,
        status: bookingStatus,
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
        tax_exempt: Boolean(payload.tax_exempt),
        tax_exempt_reason: payload.tax_exempt ? payload.tax_exempt_reason || null : null,
        tax_exempt_status: payload.tax_exempt ? payload.tax_exempt_status || "pending_form" : null,
        tax_exempt_form_collected_at:
          payload.tax_exempt && payload.tax_exempt_status === "verified"
            ? new Date().toISOString()
            : null,
      })
      .select()
      .single();

    if (bookingError || !booking) {
      console.error("admin booking insert failed", bookingError);
      return res.status(500).json({ error: "Booking insert failed" });
    }

    const amountForPayment = paymentStatus === "paid" ? pricing.total_amount : 0;

    const { data: paymentRow, error: paymentInsertError } = await supabase
      .schema("texaxes")
      .from("payments")
      .insert({
        booking_id: booking.id,
        payment_provider: "manual",
        payment_type: "full",
        status: paymentStatus,
        amount: amountForPayment,
        currency: "usd",
        paid_at: paymentStatus === "paid" ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (paymentInsertError || !paymentRow) {
      console.error("manual payment insert failed", paymentInsertError);
      return res.status(500).json({ error: "Payment record insert failed" });
    }

    const waiverUrl = buildWaiverUrl(booking.id, customer.id);
    const waiverEmailResult = await sendWaiverEmail({
      to: customer.email,
      firstName: customer.first_name,
      waiverUrl,
      bookingDate: date,
      bookingTime: time,
    });

    await writeAuditLog(
      "booking_admin_created",
      "booking",
      booking.id,
      {
        booking_id: booking.id,
        payment_id: paymentRow.id,
        customer_id: customer.id,
        time_block_id: timeBlock.id,
        party_size: throwers,
        bays_allocated: baysAllocated,
        allocation_mode: allocationMode,
        booking_source: bookingSource,
        booking_type: bookingType,
        booking_status: bookingStatus,
        payment_status: paymentStatus,
        total_amount: pricing.total_amount,
        waiver_email_sent: waiverEmailResult.sent,
        waiver_email_error: waiverEmailResult.error,
        tax_exempt: Boolean(payload.tax_exempt),
        tax_exempt_reason: payload.tax_exempt ? payload.tax_exempt_reason || null : null,
        tax_exempt_status: payload.tax_exempt ? payload.tax_exempt_status || "pending_form" : null,
      },
      "admin"
    );

    return res.json({
      success: true,
      booking_id: booking.id,
      customer_id: customer.id,
      booking_status: bookingStatus,
      payment_status: paymentStatus,
      waiver_url: waiverUrl,
      waiver_email_sent: waiverEmailResult.sent,
      waiver_email_error: waiverEmailResult.error,
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
    console.error("POST /api/admin/create-booking failed", error);
    return res.status(500).json({ error: "Failed to create booking" });
  }
});

// ======================================================
// ADMIN UPDATE BOOKING
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

      // Schedule thank-you email for next day at 10:00 AM
      if (payload.booking_status === "completed") {
        const now = new Date();
        const scheduled = new Date(now);
        scheduled.setDate(scheduled.getDate() + 1);
        scheduled.setHours(10, 0, 0, 0);

        bookingUpdates.thank_you_email_scheduled_for = scheduled.toISOString();
        bookingUpdates.thank_you_email_sent_at = null;
      }
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
          error:
            "Group too large for public booking. Contact Tex Axes for a full venue booking.",
        });
      }
      bookingUpdates.party_size = size;
    }

    if (payload.tax_exempt_status !== undefined) {
      bookingUpdates.tax_exempt_status = payload.tax_exempt_status;
      bookingUpdates.tax_exempt_form_collected_at =
        payload.tax_exempt_status === "verified" ? new Date().toISOString() : null;
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

      if (error) throw error;
    }

    if (Object.keys(paymentUpdates).length > 0) {
      const paymentRow = await getLatestPaymentByBookingId(payload.booking_id);

      if (paymentRow?.id) {
        const { error } = await supabase
          .schema("texaxes")
          .from("payments")
          .update(paymentUpdates)
          .eq("id", paymentRow.id);

        if (error) throw error;
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
// TABS / POS
// ======================================================
app.post("/api/admin/create-tab", async (req, res) => {
  try {
    const payload = req.body as CreateTabPayload;

    if (!payload?.tab_type) {
      return res.status(400).json({ error: "tab_type is required" });
    }

    const tabType = normalizeTabType(payload.tab_type);
    const status = payload.status ? normalizeTabStatus(payload.status) : "open";
    const partySize = Math.max(1, Number(payload.party_size || 1));

    if (!Number.isInteger(partySize) || partySize <= 0) {
      return res.status(400).json({ error: "Invalid party_size" });
    }

    if (tabType === "booking" && !payload.booking_id) {
      return res.status(400).json({ error: "booking_id is required for booking tabs" });
    }

    if (payload.booking_id) {
      const { data: existing } = await supabase
        .schema("texaxes")
        .from("tabs")
        .select("*")
        .eq("booking_id", payload.booking_id)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();

      if (existing) {
        return res.json({
          success: true,
          tab: {
            ...existing,
            subtotal: Number((existing as any).subtotal || 0),
            tax_total: Number((existing as any).tax_total || 0),
            grand_total: Number((existing as any).grand_total || 0),
            amount_paid: Number((existing as any).amount_paid || 0),
            balance_due: Number((existing as any).balance_due || 0),
            party_size: Number((existing as any).party_size || 1),
          },
        });
      }
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tabs")
      .insert({
        booking_id: payload.booking_id || null,
        customer_id: payload.customer_id || null,
        tab_type: tabType,
        status,
        party_name: payload.party_name?.trim() || null,
        party_size: partySize,
        notes: payload.notes?.trim() || null,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw error || new Error("Failed to create tab");
    }

    await writeAuditLog(
      "tab_created",
      "tab",
      data.id,
      {
        tab_id: data.id,
        booking_id: payload.booking_id || null,
        customer_id: payload.customer_id || null,
        tab_type: tabType,
        status,
        party_name: payload.party_name || null,
        party_size: partySize,
      },
      "admin"
    );

    return res.json({
      success: true,
      tab: {
        ...data,
        subtotal: Number((data as any).subtotal || 0),
        tax_total: Number((data as any).tax_total || 0),
        grand_total: Number((data as any).grand_total || 0),
        amount_paid: Number((data as any).amount_paid || 0),
        balance_due: Number((data as any).balance_due || 0),
        party_size: Number((data as any).party_size || 1),
      },
    });
  } catch (error: any) {
    console.error("POST /api/admin/create-tab failed", error);
    return res.status(500).json({ error: error?.message || "Failed to create tab" });
  }
});

app.get("/api/admin/get-tab", async (req, res) => {
  try {
    const tabId = String(req.query.tab_id || "").trim();
    if (!tabId) {
      return res.status(400).json({ error: "tab_id is required" });
    }

    const detail = await loadTabById(tabId);

    return res.json({
      success: true,
      tab: detail.tab,
      line_items: detail.line_items,
      payments: detail.payments,
    });
  } catch (error: any) {
    console.error("GET /api/admin/get-tab failed", error);
    return res.status(404).json({ error: error?.message || "Tab not found" });
  }
});

app.get("/api/admin/list-open-tabs", async (req, res) => {
  try {
    const rawStatus = req.query.status ? String(req.query.status) : "open";
    const search = String(req.query.search || "").trim().toLowerCase();
    const tabType = req.query.tab_type ? String(req.query.tab_type) : null;

    const status = normalizeTabStatus(rawStatus);

    let query = supabase
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
          party_size
        )
      `)
      .eq("status", status)
      .order("opened_at", { ascending: false });

    if (tabType) {
      query = query.eq("tab_type", normalizeTabType(tabType));
    }

    const { data, error } = await query;
    if (error) throw error;

    const tabs = (data || [])
      .map((row: any) => {
        const customer = row.customers || null;
        const booking = row.bookings || null;
        const fullName = customer
          ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
          : "";

        return {
          id: row.id,
          booking_id: row.booking_id,
          customer_id: row.customer_id,
          tab_type: row.tab_type,
          status: row.status,
          party_name: row.party_name,
          party_size: Number(row.party_size || 1),
          notes: row.notes,
          subtotal: Number(row.subtotal || 0),
          tax_total: Number(row.tax_total || 0),
          grand_total: Number(row.grand_total || 0),
          amount_paid: Number(row.amount_paid || 0),
          balance_due: Number(row.balance_due || 0),
          opened_at: row.opened_at,
          closed_at: row.closed_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          customer: customer
            ? {
                id: customer.id,
                first_name: customer.first_name,
                last_name: customer.last_name,
                full_name: fullName,
                email: customer.email,
                phone: customer.phone,
              }
            : null,
          booking: booking
            ? {
                id: booking.id,
                booking_type: booking.booking_type,
                booking_source: booking.booking_source,
                status: booking.status,
                party_size: Number(booking.party_size || 0),
              }
            : null,
        };
      })
      .filter((tab: any) => {
        if (!search) return true;
        const haystack = [
          tab.id,
          tab.booking_id,
          tab.party_name,
          tab.notes,
          tab.customer?.full_name,
          tab.customer?.email,
          tab.customer?.phone,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(search);
      });

    return res.json({
      success: true,
      summary: {
        count: tabs.length,
        open_count: tabs.filter((tab: any) => tab.status === "open").length,
        total_balance_due: roundMoney(
          tabs.reduce((sum: number, tab: any) => sum + Number(tab.balance_due || 0), 0)
        ),
        total_grand_total: roundMoney(
          tabs.reduce((sum: number, tab: any) => sum + Number(tab.grand_total || 0), 0)
        ),
        total_amount_paid: roundMoney(
          tabs.reduce((sum: number, tab: any) => sum + Number(tab.amount_paid || 0), 0)
        ),
      },
      tabs,
    });
  } catch (error: any) {
    console.error(
      "GET /api/admin/list-open-tabs failed FULL",
      JSON.stringify(
        {
          message: error?.message || null,
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null,
          stack: error?.stack || null,
        },
        null,
        2
      )
    );

    return res.status(500).json({
      error: error?.message || "Failed to load tabs",
      debug: {
        message: error?.message || null,
        details: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || null,
      },
    });
  }
});

app.post("/api/admin/add-line-item", async (req, res) => {
  try {
    const payload = req.body as AddLineItemPayload;

    if (!payload?.tab_id) {
      return res.status(400).json({ error: "tab_id is required" });
    }

    if (!payload?.description?.trim()) {
      return res.status(400).json({ error: "description is required" });
    }

    const itemType = normalizeTabItemType(payload.item_type);
    const quantity = Math.max(1, Number(payload.quantity || 1));
    const unitPrice = Number(payload.unit_price || 0);
    const taxable = payload.taxable !== false;
    const taxRate = Number.isFinite(Number(payload.tax_rate))
      ? Number(payload.tax_rate)
      : TAX_RATE;
    const taxExemptOverride = Boolean(payload.tax_exempt_override);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "Invalid quantity" });
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(400).json({ error: "Invalid unit_price" });
    }

    const lineSubtotal = roundMoney(quantity * unitPrice);
    const lineTax =
      taxable && !taxExemptOverride ? roundMoney(lineSubtotal * taxRate) : 0;
    const lineTotal = roundMoney(lineSubtotal + lineTax);

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .insert({
        tab_id: payload.tab_id,
        item_type: itemType,
        description: payload.description.trim(),
        quantity,
        unit_price: unitPrice,
        taxable,
        tax_rate: taxRate,
        tax_exempt_override: taxExemptOverride,
        tax_exempt_reason: taxExemptOverride
          ? payload.tax_exempt_reason?.trim() || null
          : null,
        line_subtotal: lineSubtotal,
        line_tax: lineTax,
        line_total: lineTotal,
        note: payload.note?.trim() || null,
      })
      .select("*")
      .single<TabLineItemRow>();

    if (error || !data) {
      throw error || new Error("Failed to add line item");
    }

    const tab = await recalculateTabTotals(payload.tab_id);

    await writeAuditLog(
      "tab_line_item_added",
      "tab",
      payload.tab_id,
      {
        tab_id: payload.tab_id,
        line_item_id: data.id,
        item_type: itemType,
        description: payload.description.trim(),
        quantity,
        unit_price: unitPrice,
        taxable,
        tax_exempt_override: taxExemptOverride,
        line_total: lineTotal,
      },
      "admin"
    );

    return res.json({
      success: true,
      line_item: {
        ...data,
        quantity: Number(data.quantity || 0),
        unit_price: Number(data.unit_price || 0),
        tax_rate: Number(data.tax_rate || 0),
        line_subtotal: Number(data.line_subtotal || 0),
        line_tax: Number(data.line_tax || 0),
        line_total: Number(data.line_total || 0),
      },
      tab,
    });
  } catch (error: any) {
    console.error(
      "POST /api/admin/add-line-item failed FULL",
      JSON.stringify(
        {
          message: error?.message || null,
          details: error?.details || null,
          hint: error?.hint || null,
          code: error?.code || null,
          stack: error?.stack || null,
        },
        null,
        2
      )
    );

    return res.status(500).json({
      error: error?.message || "Failed to add line item",
      debug: {
        message: error?.message || null,
        details: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || null,
      },
    });
  }
});

app.post("/api/admin/add-payment", async (req, res) => {
  try {
    const payload = req.body as AddPaymentPayload;

    if (!payload?.tab_id) {
      return res.status(400).json({ error: "tab_id is required" });
    }

    const amount = Number(payload.amount || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const paymentMethod = normalizePaymentMethod(payload.payment_method);
    const status = payload.status || "completed";

    if (!["pending", "completed", "void"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .insert({
        tab_id: payload.tab_id,
        amount: roundMoney(amount),
        payment_method: paymentMethod,
        status,
        reference: payload.reference?.trim() || null,
        note: payload.note?.trim() || null,
        collected_by: payload.collected_by?.trim() || null,
      })
      .select("*")
      .single<TabPaymentRow>();

    if (error || !data) {
      throw error || new Error("Failed to add payment");
    }

    const tab = await recalculateTabTotals(payload.tab_id);

    await writeAuditLog(
      "tab_payment_added",
      "tab",
      payload.tab_id,
      {
        tab_id: payload.tab_id,
        payment_id: data.id,
        payment_method: paymentMethod,
        amount: roundMoney(amount),
        status,
      },
      "admin"
    );

    return res.json({
      success: true,
      payment: {
        ...data,
        amount: Number(data.amount || 0),
      },
      tab,
    });
  } catch (error: any) {
    console.error("POST /api/admin/add-payment failed", error);
    return res.status(500).json({ error: error?.message || "Failed to add payment" });
  }
});

app.post("/api/admin/update-tab-status", async (req, res) => {
  try {
    const payload = req.body as UpdateTabStatusPayload;

    if (!payload?.tab_id) {
      return res.status(400).json({ error: "tab_id is required" });
    }

    const status = normalizeTabStatus(payload.status);

    const { data: existing, error: existingError } = await supabase
      .schema("texaxes")
      .from("tabs")
      .select("*")
      .eq("id", payload.tab_id)
      .single<TabRow>();

    if (existingError || !existing) {
      return res.status(404).json({ error: "Tab not found" });
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tabs")
      .update({
        status,
        closed_at: status === "closed" || status === "void" ? new Date().toISOString() : null,
        notes: payload.note?.trim()
          ? appendNote(existing.notes, `[STATUS ${status.toUpperCase()}] ${payload.note.trim()}`)
          : existing.notes,
      })
      .eq("id", payload.tab_id)
      .select("*")
      .single<TabRow>();

    if (error || !data) {
      throw error || new Error("Failed to update tab status");
    }

    await writeAuditLog(
      "tab_status_updated",
      "tab",
      payload.tab_id,
      {
        tab_id: payload.tab_id,
        status,
        note: payload.note?.trim() || null,
      },
      "admin"
    );

    return res.json({
      success: true,
      tab: {
        ...data,
        subtotal: Number(data.subtotal || 0),
        tax_total: Number(data.tax_total || 0),
        grand_total: Number(data.grand_total || 0),
        amount_paid: Number(data.amount_paid || 0),
        balance_due: Number(data.balance_due || 0),
        party_size: Number(data.party_size || 1),
      },
    });
  } catch (error: any) {
    console.error("POST /api/admin/update-tab-status failed", error);
    return res.status(500).json({ error: error?.message || "Failed to update tab status" });
  }
});

app.post("/api/admin/void-line-item", async (req, res) => {
  try {
    const payload = req.body as VoidLineItemPayload;

    if (!payload?.line_item_id) {
      return res.status(400).json({ error: "line_item_id is required" });
    }

    const { data: existing, error: existingError } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .select("*")
      .eq("id", payload.line_item_id)
      .single<TabLineItemRow>();

    if (existingError || !existing) {
      return res.status(404).json({ error: "Line item not found" });
    }

    if ((existing.note || "").includes("[VOID LINE ITEM]")) {
      return res.status(400).json({ error: "Line item already voided" });
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_line_items")
      .update({
        quantity: 0,
        unit_price: 0,
        line_subtotal: 0,
        line_tax: 0,
        line_total: 0,
        note: appendNote(
          appendNote(existing.note, "[VOID LINE ITEM]"),
          payload.note?.trim() || ""
        ),
      })
      .eq("id", payload.line_item_id)
      .select("*")
      .single<TabLineItemRow>();

    if (error || !data) {
      throw error || new Error("Failed to void line item");
    }

    const tab = await recalculateTabTotals(existing.tab_id);

    await writeAuditLog(
      "tab_line_item_voided",
      "tab",
      existing.tab_id,
      {
        tab_id: existing.tab_id,
        line_item_id: payload.line_item_id,
        note: payload.note?.trim() || null,
      },
      "admin"
    );

    return res.json({
      success: true,
      line_item: {
        ...data,
        quantity: Number(data.quantity || 0),
        unit_price: Number(data.unit_price || 0),
        tax_rate: Number(data.tax_rate || 0),
        line_subtotal: Number(data.line_subtotal || 0),
        line_tax: Number(data.line_tax || 0),
        line_total: Number(data.line_total || 0),
      },
      tab,
    });
  } catch (error: any) {
    console.error("POST /api/admin/void-line-item failed", error);
    return res.status(500).json({ error: error?.message || "Failed to void line item" });
  }
});

app.post("/api/admin/void-payment", async (req, res) => {
  try {
    const payload = req.body as VoidPaymentPayload;

    if (!payload?.payment_id) {
      return res.status(400).json({ error: "payment_id is required" });
    }

    const { data: existing, error: existingError } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .select("*")
      .eq("id", payload.payment_id)
      .single<TabPaymentRow>();

    if (existingError || !existing) {
      return res.status(404).json({ error: "Payment not found" });
    }

    if (existing.status === "void") {
      return res.status(400).json({ error: "Payment already voided" });
    }

    const { data, error } = await supabase
      .schema("texaxes")
      .from("tab_payments")
      .update({
        status: "void",
        note: appendNote(
          appendNote(existing.note, "[VOID PAYMENT]"),
          payload.note?.trim() || ""
        ),
      })
      .eq("id", payload.payment_id)
      .select("*")
      .single<TabPaymentRow>();

    if (error || !data) {
      throw error || new Error("Failed to void payment");
    }

    const tab = await recalculateTabTotals(existing.tab_id);

    await writeAuditLog(
      "tab_payment_voided",
      "tab",
      existing.tab_id,
      {
        tab_id: existing.tab_id,
        payment_id: payload.payment_id,
        note: payload.note?.trim() || null,
      },
      "admin"
    );

    return res.json({
      success: true,
      payment: {
        ...data,
        amount: Number(data.amount || 0),
      },
      tab,
    });
  } catch (error: any) {
    console.error("POST /api/admin/void-payment failed", error);
    return res.status(500).json({ error: error?.message || "Failed to void payment" });
  }
});

// ======================================================
// PUBLIC BOOKING
// ======================================================
app.post("/book", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "Stripe is not configured" });
    }

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
        error:
          "Group too large for public booking. Contact Tex Axes for a full venue booking.",
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
    const waiverStatus = deriveInitialWaiverStatus(payload);
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
          if (!addonId) return null;

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
      payment_intent_data: {
        metadata: {
          booking_id: booking.id,
          payment_id: paymentRow.id,
          customer_id: customer.id,
          booking_source: bookingSource,
        },
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

    const waiverUrl = buildWaiverUrl(booking.id, customer.id);
    const waiverEmailResult = await sendWaiverEmail({
      to: customer.email,
      firstName: customer.first_name,
      waiverUrl,
      bookingDate: date,
      bookingTime: time,
    });

    await writeAuditLog("booking_created", "booking", booking.id, {
      booking_id: booking.id,
      customer_id: customer.id,
      time_block_id: timeBlock.id,
      party_size: throwers,
      bays_allocated: baysAllocated,
      allocation_mode: allocationMode,
      total_amount: pricing.total_amount,
      booking_source: bookingSource,
      waiver_email_sent: waiverEmailResult.sent,
      waiver_email_error: waiverEmailResult.error,
    });

    return res.json({
      booking_id: booking.id,
      customer_id: customer.id,
      checkout_url: session.url,
      waiver_url: waiverUrl,
      waiver_email_sent: waiverEmailResult.sent,
      waiver_email_error: waiverEmailResult.error,
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

// ======================================================
// SEND THANK-YOU EMAILS (NEXT DAY FOLLOW-UP)
// ======================================================
app.post("/api/admin/send-thank-you-emails", async (req, res) => {
  try {
    const nowIso = new Date().toISOString();

    // 1. Get all bookings ready to send
    const { data: bookings, error } = await supabase
      .schema("texaxes")
      .from("bookings")
      .select(`
        id,
        customer_id,
        thank_you_email_scheduled_for,
        thank_you_email_sent_at,
        customers (
          email,
          first_name
        )
      `)
      .not("thank_you_email_scheduled_for", "is", null)
      .is("thank_you_email_sent_at", null)
      .lte("thank_you_email_scheduled_for", nowIso);

    if (error) throw error;

    if (!bookings || bookings.length === 0) {
      return res.json({
        success: true,
        processed: 0,
        sent: 0,
      });
    }

    let sentCount = 0;

    // 2. Process each booking
    for (const booking of bookings) {
      const email = booking.customers?.email?.trim();
      const firstName = booking.customers?.first_name || "there";

      if (!email) {
        continue; // skip if no email
      }

      try {
        const emailContent = buildThankYouEmail({
          firstName,
          couponCode: "THANKYOU20",
          discountLabel: "20% off",
          validDays: 30,
        });

        const { error: sendError } = await resend.emails.send({
          from: WAIVER_FROM_EMAIL,
          to: email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        if (sendError) {
          console.error("Thank-you email failed", sendError);
          continue;
        }

        // 3. Mark as sent
        const { error: updateError } = await supabase
          .schema("texaxes")
          .from("bookings")
          .update({
            thank_you_email_sent_at: new Date().toISOString(),
          })
          .eq("id", booking.id);

        if (updateError) {
          console.error("Failed to mark thank-you email sent", updateError);
          continue;
        }

        // 4. Audit log
        await writeAuditLog(
          "thank_you_email_sent",
          "booking",
          booking.id,
          {
            booking_id: booking.id,
            email,
          },
          "system"
        );

        sentCount++;
      } catch (innerError) {
        console.error("Error processing thank-you email", innerError);
      }
    }

    return res.json({
      success: true,
      processed: bookings.length,
      sent: sentCount,
    });
  } catch (error) {
    console.error("POST /api/admin/send-thank-you-emails failed", error);
    return res.status(500).json({
      error: "Failed to send thank-you emails",
    });
  }
});

export default app;

