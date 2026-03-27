import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TabStatus = "open" | "closed" | "void";
type TabType = "booking" | "walk_in" | "spectator" | "retail_only";

function setCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function normalizeStatus(value?: string): TabStatus {
  if (value === "closed") return "closed";
  if (value === "void") return "void";
  return "open";
}

function normalizeType(value?: string): TabType | null {
  if (
    value === "booking" ||
    value === "walk_in" ||
    value === "spectator" ||
    value === "retail_only"
  ) {
    return value;
  }
  return null;
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
    const status = normalizeStatus(
      typeof req.query.status === "string" ? req.query.status : undefined
    );
    const tabType = normalizeType(
      typeof req.query.tab_type === "string" ? req.query.tab_type : undefined
    );
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";

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
      query = query.eq("tab_type", tabType);
    }

    const { data, error } = await query;

    if (error) {
      console.error("list-open-tabs query failed", error);
      return res.status(500).json({ error: "Failed to load tabs" });
    }

    let tabs = (data || []).map((row: any) => {
      const customer = row.customers || null;
      const booking = row.bookings || null;

      const customerName = customer
        ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        : "";

      return {
        id: row.id,
        booking_id: row.booking_id,
        customer_id: row.customer_id,
        tab_type: row.tab_type,
        status: row.status,
        party_name: row.party_name,
        party_size: row.party_size,
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
              full_name: customerName,
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
              party_size: booking.party_size,
            }
          : null,
      };
    });

    if (search) {
      const searchLower = search.toLowerCase();

      tabs = tabs.filter((tab) => {
        const haystack = [
          tab.id,
          tab.party_name,
          tab.notes,
          tab.customer?.full_name,
          tab.customer?.email,
          tab.customer?.phone,
          tab.booking?.id,
          tab.booking?.booking_type,
          tab.booking?.booking_source,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(searchLower);
      });
    }

    const summary = {
      count: tabs.length,
      open_count: tabs.filter((tab) => tab.status === "open").length,
      total_balance_due: tabs.reduce((sum, tab) => sum + Number(tab.balance_due || 0), 0),
      total_grand_total: tabs.reduce((sum, tab) => sum + Number(tab.grand_total || 0), 0),
      total_amount_paid: tabs.reduce((sum, tab) => sum + Number(tab.amount_paid || 0), 0),
    };

    return res.status(200).json({
      success: true,
      summary,
      tabs,
    });
  } catch (err: any) {
    console.error("list-open-tabs failed", err);
    return res.status(500).json({ error: err?.message || "Server error" });
  }
}
