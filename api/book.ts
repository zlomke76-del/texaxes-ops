import Stripe from "stripe";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);
const WAIVER_FROM_EMAIL =
  process.env.WAIVER_FROM_EMAIL || "Tex Axes <onboarding@resend.dev>";
const INTERNAL_BOOKING_EMAIL = "texaxes@outlook.com";

const PRICE_PER_THROWER = 29;
const TAX_RATE = 0.0825;
const PUBLIC_MAX_PARTY_SIZE = 24;
const PREFERRED_THROWERS_PER_BAY = 4;
const MAX_THROWERS_PER_BAY = 6;

const ADDON_PRICES = {
  byob: 5,
  wktl_knife_rental: 20,
  pro_axe: 10,
  big_axe: 15,
  shovel: 20,
} as const;

type TaxExemptStatus = "pending_form" | "verified";

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
  customer_notes?: string | null;
  internal_notes?: string | null;
  tax_exempt?: boolean;
  tax_exempt_reason?: string | null;
  tax_exempt_status?: TaxExemptStatus | null;
  tax_exempt_note?: string | null;
  offer_code?: string | null;
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
  tax_exempt: boolean;
  addon_lines: Array<{
    addon_code: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
};

type EmailSendResult = {
  sent: boolean;
  error: string | null;
};

type CustomerOfferRow = {
  id: string;
  code: string;
  offer_type: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  status: string;
  expires_at: string | null;
};

function setCors(req: any, res: any) {
  const origin = req.headers.origin || "";

  if (
    origin.includes("vercel.app") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1") ||
    origin.includes("texaxes.com")
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function methodNotAllowed(res: any) {
  res.setHeader("Allow", "POST, OPTIONS");
  return res.status(405).json({ error: "Method not allowed" });
}

function badRequest(res: any, message: string) {
  return res.status(400).json({ error: message });
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
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

function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeOptionalText(value?: string | null): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeTaxExemptStatus(
  value?: string | null
): TaxExemptStatus | null {
  if (value === "pending_form" || value === "verified") {
    return value;
  }
  return null;
}

function computeBayRequirements(throwers: number) {
  return {
    preferred: Math.ceil(throwers / PREFERRED_THROWERS_PER_BAY),
    minimum: Math.ceil(throwers / MAX_THROWERS_PER_BAY),
  };
}

function calculateAgeOnDate(birthDate: string, onDate: string): number {
  const birth = new Date(`${birthDate}T00:00:00`);
  const target = new Date(`${onDate}T00:00:00`);

  let age = target.getFullYear() - birth.getFullYear();
  const monthDelta = target.getMonth() - birth.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && target.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age;
}

function deriveWaiverStatus(
  customer: BookingPayload["customer"]
): "missing" | "guardian_required" {
  return customer.is_minor ? "guardian_required" : "missing";
}

function formatDisplayTime(time: string): string {
  return time.slice(0, 5);
}

function formatMoney(value: number): string {
  return `$${Number(value || 0).toFixed(2)}`;
}

function buildWaiverUrl(bookingId: string, customerId: string): string {
  return `${FRONTEND_URL}/waiver?booking_id=${encodeURIComponent(
    bookingId
  )}&customer_id=${encodeURIComponent(customerId)}`;
}

async function getWaiverStatusForCustomer(
  customerId: string,
  bookingDate: string
): Promise<"signed" | "expired" | "missing" | "guardian_required"> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("waivers")
    .select("expires_at, is_minor, guardian_customer_id")
    .eq("customer_id", customerId)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!data) return "missing";

  const booking = new Date(`${bookingDate}T00:00:00`);
  const expiry = new Date(data.expires_at);

  if (expiry < booking) return "expired";

  if (data.is_minor && !data.guardian_customer_id) {
    return "guardian_required";
  }

  return "signed";
}

function computePricing(payload: BookingPayload, taxExempt: boolean): PricingResult {
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
    .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0)
    .map((line) => ({
      ...line,
      line_total: roundMoney(line.quantity * line.unit_price),
    }));

  const addons_subtotal = roundMoney(
    addon_lines.reduce((sum, line) => sum + line.line_total, 0)
  );

  const subtotal = roundMoney(base_price + addons_subtotal);
  const tax_amount = taxExempt ? 0 : roundMoney(subtotal * TAX_RATE);
  const total_amount = roundMoney(subtotal + tax_amount);

  return {
    base_price,
    addons_subtotal,
    subtotal,
    tax_amount,
    total_amount,
    tax_exempt: taxExempt,
    addon_lines,
  };
}

function buildInternalNotes(payload: BookingPayload, taxExempt: boolean): string | null {
  const notes: string[] = [];

  if (taxExempt) {
    notes.push("[TAX EXEMPT]");
    notes.push(
      `Reason: ${normalizeOptionalText(payload.tax_exempt_reason) || "not specified"}`
    );

    if (payload.tax_exempt_status === "verified") {
      notes.push("Tax exempt form collected.");
    } else {
      notes.push("Collect tax exempt form.");
    }

    if (normalizeOptionalText(payload.tax_exempt_note)) {
      notes.push(`Tax note: ${normalizeOptionalText(payload.tax_exempt_note)}`);
    }
  }

  if (normalizeOptionalText(payload.internal_notes)) {
    notes.push(normalizeOptionalText(payload.internal_notes)!);
  }

  return notes.length ? notes.join("\n") : null;
}

function computeDiscountAmount(
  pricing: PricingResult,
  offer: CustomerOfferRow
): number {
  if (offer.discount_type === "percent") {
    return roundMoney(pricing.total_amount * (Number(offer.discount_value || 0) / 100));
  }

  if (offer.discount_type === "fixed") {
    return roundMoney(
      Math.min(pricing.total_amount, Number(offer.discount_value || 0))
    );
  }

  return 0;
}

async function getActiveOfferByCode(code: string): Promise<CustomerOfferRow | null> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("customer_offers")
    .select(
      "id, code, offer_type, discount_type, discount_value, status, expires_at"
    )
    .eq("code", code)
    .eq("status", "active")
    .maybeSingle<CustomerOfferRow>();

  if (error) throw error;
  return data ?? null;
}

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.schema("texaxes").from("audit_log").insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor_type: "system",
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
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);

  if (normalizedEmail) {
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

  if (normalizedPhone) {
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

async function findOrCreateCustomer(
  customer: BookingPayload["customer"]
): Promise<CustomerRow> {
  const existing = await findExistingCustomer(customer.email, customer.phone);
  if (existing) return existing;

  const { data, error } = await supabase
    .schema("texaxes")
    .from("customers")
    .insert({
      first_name: customer.first_name.trim(),
      last_name: customer.last_name.trim(),
      email: normalizeEmail(customer.email),
      phone: normalizePhone(customer.phone),
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

  const out = new Map<string, string>();
  for (const row of data || []) {
    out.set(row.code, row.id);
  }
  return out;
}

async function sendCustomerBookingEmail(params: {
  to: string | null;
  bookingId: string;
  customerName: string;
  date: string;
  time: string;
  partySize: number;
  totalAmount: number;
  checkoutUrl: string | null;
  waiverUrl: string;
  bookingSource: string;
  discountAmount?: number;
  offerCode?: string | null;
}): Promise<EmailSendResult> {
  try {
    if (!params.to) {
      return { sent: false, error: "missing_customer_email" };
    }

    if (!resend) {
      return { sent: false, error: "resend_not_configured" };
    }

    const subject = `Your Tex Axes booking for ${params.date} at ${formatDisplayTime(
      params.time
    )}`;

    const text = [
      `Hi ${params.customerName},`,
      "",
      "Thanks for booking with Tex Axes.",
      "",
      `Booking ID: ${params.bookingId}`,
      `Date: ${params.date}`,
      `Time: ${formatDisplayTime(params.time)}`,
      `Party Size: ${params.partySize}`,
      params.discountAmount && params.discountAmount > 0
        ? `Discount Applied: ${formatMoney(params.discountAmount)}`
        : null,
      params.offerCode ? `Offer Code: ${params.offerCode}` : null,
      `Total: ${formatMoney(params.totalAmount)}`,
      "",
      params.checkoutUrl ? "Complete payment here:" : null,
      params.checkoutUrl || null,
      "",
      "Complete your waiver before arrival:",
      params.waiverUrl,
      "",
      "We look forward to seeing you at Tex Axes.",
    ]
      .filter(Boolean)
      .join("\n");

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <p>Hi ${params.customerName},</p>
        <p>Thanks for booking with <strong>Tex Axes</strong>.</p>
        <p>
          <strong>Booking ID:</strong> ${params.bookingId}<br />
          <strong>Date:</strong> ${params.date}<br />
          <strong>Time:</strong> ${formatDisplayTime(params.time)}<br />
          <strong>Party Size:</strong> ${params.partySize}<br />
          ${
            params.discountAmount && params.discountAmount > 0
              ? `<strong>Discount Applied:</strong> ${formatMoney(params.discountAmount)}<br />`
              : ""
          }
          ${
            params.offerCode
              ? `<strong>Offer Code:</strong> ${params.offerCode}<br />`
              : ""
          }
          <strong>Total:</strong> ${formatMoney(params.totalAmount)}
        </p>
        ${
          params.checkoutUrl
            ? `<p><a href="${params.checkoutUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Complete Payment</a></p>
               <p style="word-break:break-all;color:#4b5563;">${params.checkoutUrl}</p>`
            : ""
        }
        <p><a href="${params.waiverUrl}" style="display:inline-block;padding:12px 18px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Complete Waiver</a></p>
        <p style="word-break:break-all;color:#4b5563;">${params.waiverUrl}</p>
        <p>We look forward to seeing you at Tex Axes.</p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: WAIVER_FROM_EMAIL,
      to: params.to,
      subject,
      text,
      html,
    });

    if (error) {
      return { sent: false, error: error.message || "customer_booking_email_failed" };
    }

    return { sent: true, error: null };
  } catch (error: any) {
    return {
      sent: false,
      error: error?.message || "customer_booking_email_failed",
    };
  }
}

async function sendCustomerWaiverEmail(params: {
  to: string | null;
  customerName: string;
  waiverUrl: string;
  date: string;
  time: string;
}): Promise<EmailSendResult> {
  try {
    if (!params.to) {
      return { sent: false, error: "missing_customer_email" };
    }

    if (!resend) {
      return { sent: false, error: "resend_not_configured" };
    }

    const subject = "Complete Your Tex Axes Waiver";

    const text = [
      `Hi ${params.customerName},`,
      "",
      "Please complete your Tex Axes waiver before arrival.",
      `Booking time: ${params.date} at ${formatDisplayTime(params.time)}`,
      "",
      params.waiverUrl,
      "",
      "If the waiver is for a minor participant, a parent or legal guardian must complete it.",
    ].join("\n");

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <p>Hi ${params.customerName},</p>
        <p>Please complete your Tex Axes waiver before arrival.</p>
        <p><strong>Booking time:</strong> ${params.date} at ${formatDisplayTime(
          params.time
        )}</p>
        <p>
          <a href="${params.waiverUrl}" style="display:inline-block;padding:12px 18px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
            Complete Waiver
          </a>
        </p>
        <p style="word-break:break-all;color:#4b5563;">${params.waiverUrl}</p>
        <p>If the waiver is for a minor participant, a parent or legal guardian must complete it.</p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: WAIVER_FROM_EMAIL,
      to: params.to,
      subject,
      text,
      html,
    });

    if (error) {
      return { sent: false, error: error.message || "customer_waiver_email_failed" };
    }

    return { sent: true, error: null };
  } catch (error: any) {
    return {
      sent: false,
      error: error?.message || "customer_waiver_email_failed",
    };
  }
}

async function sendInternalBookingEmail(params: {
  bookingId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  date: string;
  time: string;
  partySize: number;
  totalAmount: number;
  bookingSource: string;
  bookingType: string;
  taxExempt: boolean;
  taxExemptReason: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  discountAmount?: number;
  offerCode?: string | null;
}): Promise<EmailSendResult> {
  try {
    if (!resend) {
      return { sent: false, error: "resend_not_configured" };
    }

    const subject = `New Tex Axes Booking — ${params.date} ${formatDisplayTime(
      params.time
    )}`;

    const text = [
      "New Tex Axes booking created.",
      "",
      `Booking ID: ${params.bookingId}`,
      `Customer: ${params.customerName}`,
      `Email: ${params.customerEmail || "none"}`,
      `Phone: ${params.customerPhone || "none"}`,
      `Date: ${params.date}`,
      `Time: ${formatDisplayTime(params.time)}`,
      `Party Size: ${params.partySize}`,
      params.discountAmount && params.discountAmount > 0
        ? `Discount Applied: ${formatMoney(params.discountAmount)}`
        : null,
      params.offerCode ? `Offer Code: ${params.offerCode}` : null,
      `Total: ${formatMoney(params.totalAmount)}`,
      `Source: ${params.bookingSource}`,
      `Type: ${params.bookingType}`,
      `Tax Exempt: ${params.taxExempt ? "Yes" : "No"}`,
      params.taxExemptReason ? `Tax Exempt Reason: ${params.taxExemptReason}` : null,
      params.customerNotes ? `Customer Notes: ${params.customerNotes}` : null,
      params.internalNotes ? `Internal Notes: ${params.internalNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;">
        <h2>New Tex Axes Booking</h2>
        <p>
          <strong>Booking ID:</strong> ${params.bookingId}<br />
          <strong>Customer:</strong> ${params.customerName}<br />
          <strong>Email:</strong> ${params.customerEmail || "none"}<br />
          <strong>Phone:</strong> ${params.customerPhone || "none"}<br />
          <strong>Date:</strong> ${params.date}<br />
          <strong>Time:</strong> ${formatDisplayTime(params.time)}<br />
          <strong>Party Size:</strong> ${params.partySize}<br />
          ${
            params.discountAmount && params.discountAmount > 0
              ? `<strong>Discount Applied:</strong> ${formatMoney(params.discountAmount)}<br />`
              : ""
          }
          ${
            params.offerCode
              ? `<strong>Offer Code:</strong> ${params.offerCode}<br />`
              : ""
          }
          <strong>Total:</strong> ${formatMoney(params.totalAmount)}<br />
          <strong>Source:</strong> ${params.bookingSource}<br />
          <strong>Type:</strong> ${params.bookingType}<br />
          <strong>Tax Exempt:</strong> ${params.taxExempt ? "Yes" : "No"}
        </p>
        ${params.taxExemptReason ? `<p><strong>Tax Exempt Reason:</strong> ${params.taxExemptReason}</p>` : ""}
        ${params.customerNotes ? `<p><strong>Customer Notes:</strong><br />${params.customerNotes.replace(/\n/g, "<br />")}</p>` : ""}
        ${params.internalNotes ? `<p><strong>Internal Notes:</strong><br />${params.internalNotes.replace(/\n/g, "<br />")}</p>` : ""}
      </div>
    `;

    const { error } = await resend.emails.send({
      from: WAIVER_FROM_EMAIL,
      to: INTERNAL_BOOKING_EMAIL,
      subject,
      text,
      html,
    });

    if (error) {
      return { sent: false, error: error.message || "internal_booking_email_failed" };
    }

    return { sent: true, error: null };
  } catch (error: any) {
    return {
      sent: false,
      error: error?.message || "internal_booking_email_failed",
    };
  }
}

export default async function handler(req: any, res: any) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return methodNotAllowed(res);
  }

  try {
    const payload = req.body as BookingPayload;

    if (!payload?.date || !payload?.time || !payload?.throwers || !payload?.customer) {
      return badRequest(res, "Missing required fields");
    }

    if (!payload.customer.first_name?.trim() || !payload.customer.last_name?.trim()) {
      return badRequest(res, "Customer first and last name are required");
    }

    const date = normalizeDate(payload.date);
    const time = normalizeTime(payload.time);
    const throwers = Number(payload.throwers);
    const bookingSource = payload.booking_source || "public";
    const bookingType = payload.booking_type || "open";

    if (!Number.isInteger(throwers) || throwers <= 0) {
      return badRequest(res, "Invalid thrower count");
    }

    if (throwers > PUBLIC_MAX_PARTY_SIZE) {
      return res.status(400).json({
        error: "Group too large for public booking. Contact Tex Axes for a full venue booking.",
      });
    }

    const requestedTaxExempt = Boolean(payload.tax_exempt);
    const normalizedTaxExemptStatus = normalizeTaxExemptStatus(payload.tax_exempt_status);
    const isStaffManagedBooking = bookingSource !== "public";

    if (requestedTaxExempt && !isStaffManagedBooking) {
      return badRequest(res, "Tax exemption can only be applied to staff-managed bookings");
    }

    if (requestedTaxExempt && !normalizeOptionalText(payload.tax_exempt_reason)) {
      return badRequest(res, "Tax exempt reason is required");
    }

    const taxExempt = requestedTaxExempt && isStaffManagedBooking;
    const taxExemptStatus = taxExempt
      ? normalizedTaxExemptStatus || "pending_form"
      : null;

    if (payload.customer.birth_date) {
      const age = calculateAgeOnDate(payload.customer.birth_date, date);
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
    if (!capacity || !capacity.is_open || !capacity.is_bookable) {
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
    let pricing = computePricing(payload, taxExempt);
    const waiverStatus = deriveWaiverStatus(payload.customer);
    const internalNotes = buildInternalNotes(payload, taxExempt);
    const customerNotes = normalizeOptionalText(payload.customer_notes);

    let appliedOffer: CustomerOfferRow | null = null;
    let discountAmount = 0;
    const normalizedOfferCode = normalizeOptionalText(payload.offer_code)?.toUpperCase() || null;

    if (normalizedOfferCode) {
      const offer = await getActiveOfferByCode(normalizedOfferCode);

      if (!offer) {
        return res.status(400).json({ error: "Invalid offer code" });
      }

      const nowIso = new Date().toISOString();
      if (offer.expires_at && offer.expires_at < nowIso) {
        return res.status(400).json({ error: "Offer expired" });
      }

      discountAmount = computeDiscountAmount(pricing, offer);

      pricing = {
        ...pricing,
        total_amount: roundMoney(Math.max(0, pricing.total_amount - discountAmount)),
      };

      appliedOffer = {
        ...offer,
        discount_value: Number(offer.discount_value || 0),
      };
    }

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
        internal_notes: internalNotes,
        customer_notes: customerNotes,
        created_by: bookingSource,
        tax_exempt: taxExempt,
        tax_exempt_reason: taxExempt
          ? normalizeOptionalText(payload.tax_exempt_reason)
          : null,
        tax_exempt_status: taxExempt ? taxExemptStatus : null,
        offer_code: appliedOffer?.code || null,
      })
      .select()
      .single();

    if (bookingError || !booking) {
      console.error("booking insert failed", bookingError);
      return res.status(500).json({ error: "Booking insert failed" });
    }

    const postInsertCapacity = await getCapacityRowForBlock(timeBlock.id);
    if (postInsertCapacity && postInsertCapacity.bays_open < 0) {
      await supabase.schema("texaxes").from("bookings").delete().eq("id", booking.id);

      return res.status(409).json({
        error: "Slot just filled. Please select another time.",
      });
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
        const { error: addonError } = await supabase
          .schema("texaxes")
          .from("booking_addons")
          .insert(addonRows as any[]);

        if (addonError) {
          console.error("booking_addons insert failed", addonError);
          await supabase.schema("texaxes").from("bookings").delete().eq("id", booking.id);
          return res.status(500).json({ error: "Booking add-on insert failed" });
        }
      }
    }

    const { data: paymentRow, error: paymentError } = await supabase
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

    if (paymentError || !paymentRow) {
      console.error("payments insert failed", paymentError);
      await supabase.schema("texaxes").from("bookings").delete().eq("id", booking.id);
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
        tax_exempt: String(taxExempt),
        tax_exempt_status: taxExemptStatus || "",
        offer_code: appliedOffer?.code || "",
        customer_offer_id: appliedOffer?.id || "",
        discount_amount: String(discountAmount || 0),
      },
      payment_intent_data: {
        metadata: {
          booking_id: booking.id,
          payment_id: paymentRow.id,
          customer_id: customer.id,
          booking_source: bookingSource,
          tax_exempt: String(taxExempt),
          tax_exempt_status: taxExemptStatus || "",
          offer_code: appliedOffer?.code || "",
          customer_offer_id: appliedOffer?.id || "",
          discount_amount: String(discountAmount || 0),
        },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: taxExempt ? "Tex Axes Booking (Tax Exempt)" : "Tex Axes Booking",
              description: `${date} ${time.slice(0, 5)} · ${throwers} thrower(s)${
                appliedOffer ? ` · Offer ${appliedOffer.code}` : ""
              }`,
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

    const customerBookingEmail = await sendCustomerBookingEmail({
      to: customer.email,
      bookingId: booking.id,
      customerName: `${customer.first_name} ${customer.last_name}`.trim(),
      date,
      time,
      partySize: throwers,
      totalAmount: pricing.total_amount,
      checkoutUrl: session.url,
      waiverUrl,
      bookingSource,
      discountAmount,
      offerCode: appliedOffer?.code || null,
    });

    const customerWaiverEmail = await sendCustomerWaiverEmail({
      to: customer.email,
      customerName: `${customer.first_name} ${customer.last_name}`.trim(),
      waiverUrl,
      date,
      time,
    });

    const internalBookingEmail = await sendInternalBookingEmail({
      bookingId: booking.id,
      customerName: `${customer.first_name} ${customer.last_name}`.trim(),
      customerEmail: customer.email,
      customerPhone: customer.phone,
      date,
      time,
      partySize: throwers,
      totalAmount: pricing.total_amount,
      bookingSource,
      bookingType,
      taxExempt,
      taxExemptReason: taxExempt
        ? normalizeOptionalText(payload.tax_exempt_reason)
        : null,
      customerNotes,
      internalNotes,
      discountAmount,
      offerCode: appliedOffer?.code || null,
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
      tax_exempt: taxExempt,
      tax_exempt_reason: taxExempt
        ? normalizeOptionalText(payload.tax_exempt_reason)
        : null,
      tax_exempt_status: taxExemptStatus,
      offer_code: appliedOffer?.code || null,
      customer_offer_id: appliedOffer?.id || null,
      discount_amount: discountAmount,
      customer_booking_email_sent: customerBookingEmail.sent,
      customer_booking_email_error: customerBookingEmail.error,
      customer_waiver_email_sent: customerWaiverEmail.sent,
      customer_waiver_email_error: customerWaiverEmail.error,
      internal_booking_email_sent: internalBookingEmail.sent,
      internal_booking_email_error: internalBookingEmail.error,
    });

    return res.status(200).json({
      booking_id: booking.id,
      customer_id: customer.id,
      checkout_url: session.url,
      waiver_url: waiverUrl,
      totals: {
        base_price: pricing.base_price,
        addons_subtotal: pricing.addons_subtotal,
        subtotal: pricing.subtotal,
        tax_amount: pricing.tax_amount,
        discount_amount: discountAmount,
        total_amount: pricing.total_amount,
      },
      allocation: {
        mode: allocationMode,
        bays_allocated: baysAllocated,
        preferred_bays_required: preferred,
        minimum_bays_required: minimum,
      },
      tax_exempt: taxExempt,
      tax_exempt_reason: taxExempt
        ? normalizeOptionalText(payload.tax_exempt_reason)
        : null,
      tax_exempt_status: taxExemptStatus,
      offer: appliedOffer
        ? {
            id: appliedOffer.id,
            code: appliedOffer.code,
            discount_type: appliedOffer.discount_type,
            discount_value: appliedOffer.discount_value,
            expires_at: appliedOffer.expires_at,
          }
        : null,
      emails: {
        customer_booking_sent: customerBookingEmail.sent,
        customer_booking_error: customerBookingEmail.error,
        customer_waiver_sent: customerWaiverEmail.sent,
        customer_waiver_error: customerWaiverEmail.error,
        internal_booking_sent: internalBookingEmail.sent,
        internal_booking_error: internalBookingEmail.error,
      },
    });
  } catch (error) {
    console.error("POST /api/book failed", error);
    return res.status(500).json({ error: "Booking failed" });
  }
}
