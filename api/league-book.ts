import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STANDARD_LEAGUE_PRICE = 120;
const DUALS_PLAYER_PRICE = 60;
const TAX_RATE = 0.0825;

type LeagueDiscipline =
  | "hatchet"
  | "hatchetDuals"
  | "knife"
  | "knifeDuals"
  | "bigaxe";

type LeagueEntryPayload = {
  discipline: LeagueDiscipline;
  season_label: string;
  season_start_sunday: string;
  lane_label: string;
  lane_date: string;
  lane_time: string;
};

type LeaguePlayerPayload = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  experience_level?: string | null;
  notes?: string | null;
  marketing_opt_in?: boolean;
  entries: LeagueEntryPayload[];
};

type LeagueBookPayload = {
  season_label: string;
  season_start_sunday: string;
  players: LeaguePlayerPayload[];
  pricing?: unknown;
  registration_source?: string;
};

type LeagueRegistrationRow = {
  id: string;
};

type LeaguePlayerRow = {
  id: string;
};

type LeagueEntryRow = {
  id: string;
};

type PriceRow = {
  player_index: number;
  entry_index: number;
  player_name: string;
  discipline: LeagueDiscipline;
  season_label: string;
  season_start_sunday: string;
  lane_label: string;
  lane_date: string;
  lane_time: string;
  base: number;
  discount_index: number;
  discount_rate: number;
  discount_amount: number;
  final_price: number;
};

type PricingResult = {
  rows: PriceRow[];
  registration_count: number;
  base_total: number;
  savings_total: number;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
};

function setCors(req: any, res: any) {
  const origin = req.headers.origin || "";

  if (
    origin.includes("vercel.app") ||
    origin.includes("localhost") ||
    origin.includes("127.0.0.1")
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

function getLeagueBasePrice(discipline: LeagueDiscipline): number {
  if (discipline === "hatchetDuals" || discipline === "knifeDuals") {
    return DUALS_PLAYER_PRICE;
  }
  return STANDARD_LEAGUE_PRICE;
}

function getLeagueDiscountRate(index: number): number {
  if (index === 0) return 0;
  if (index === 1) return 0.05;
  if (index === 2) return 0.1;
  if (index === 3) return 0.15;
  return 0.2;
}

function computeLeagueSessionPricing(players: LeaguePlayerPayload[]): PricingResult {
  const rows: Array<{
    player_index: number;
    entry_index: number;
    player_name: string;
    discipline: LeagueDiscipline;
    season_label: string;
    season_start_sunday: string;
    lane_label: string;
    lane_date: string;
    lane_time: string;
    base: number;
  }> = [];

  players.forEach((player, playerIndex) => {
    const playerName =
      `${player.first_name || ""} ${player.last_name || ""}`.trim() ||
      `Player ${playerIndex + 1}`;

    player.entries.forEach((entry, entryIndex) => {
      rows.push({
        player_index: playerIndex,
        entry_index: entryIndex,
        player_name: playerName,
        discipline: entry.discipline,
        season_label: entry.season_label,
        season_start_sunday: entry.season_start_sunday,
        lane_label: entry.lane_label,
        lane_date: entry.lane_date,
        lane_time: entry.lane_time,
        base: getLeagueBasePrice(entry.discipline),
      });
    });
  });

  rows.sort((a, b) => b.base - a.base);

  const pricedRows: PriceRow[] = rows.map((row, index) => {
    const discountRate = getLeagueDiscountRate(index);
    const discountAmount = roundMoney(row.base * discountRate);
    const finalPrice = roundMoney(row.base - discountAmount);

    return {
      ...row,
      discount_index: index,
      discount_rate: discountRate,
      discount_amount: discountAmount,
      final_price: finalPrice,
    };
  });

  const baseTotal = roundMoney(pricedRows.reduce((sum, row) => sum + row.base, 0));
  const savingsTotal = roundMoney(
    pricedRows.reduce((sum, row) => sum + row.discount_amount, 0)
  );
  const subtotal = roundMoney(
    pricedRows.reduce((sum, row) => sum + row.final_price, 0)
  );
  const taxAmount = roundMoney(subtotal * TAX_RATE);
  const totalAmount = roundMoney(subtotal + taxAmount);

  return {
    rows: pricedRows,
    registration_count: pricedRows.length,
    base_total: baseTotal,
    savings_total: savingsTotal,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
  };
}

function validatePayload(payload: LeagueBookPayload) {
  if (!payload?.season_label?.trim()) {
    throw new Error("Missing season_label");
  }

  if (!payload?.season_start_sunday?.trim()) {
    throw new Error("Missing season_start_sunday");
  }

  normalizeDate(payload.season_start_sunday);

  if (!Array.isArray(payload.players) || payload.players.length === 0) {
    throw new Error("At least one player is required");
  }

  payload.players.forEach((player, playerIndex) => {
    if (!player.first_name?.trim() || !player.last_name?.trim()) {
      throw new Error(`Player ${playerIndex + 1} first and last name are required`);
    }

    if (!normalizeEmail(player.email)) {
      throw new Error(`Player ${playerIndex + 1} valid email is required`);
    }

    if (!Array.isArray(player.entries) || player.entries.length === 0) {
      throw new Error(`Player ${playerIndex + 1} must have at least one league entry`);
    }

    player.entries.forEach((entry, entryIndex) => {
      if (!entry.discipline) {
        throw new Error(
          `Player ${playerIndex + 1} entry ${entryIndex + 1} missing discipline`
        );
      }

      if (!entry.season_label?.trim()) {
        throw new Error(
          `Player ${playerIndex + 1} entry ${entryIndex + 1} missing season_label`
        );
      }

      if (!entry.season_start_sunday?.trim()) {
        throw new Error(
          `Player ${playerIndex + 1} entry ${entryIndex + 1} missing season_start_sunday`
        );
      }

      if (!entry.lane_label?.trim() || !entry.lane_date?.trim() || !entry.lane_time?.trim()) {
        throw new Error(
          `Player ${playerIndex + 1} entry ${entryIndex + 1} missing lane details`
        );
      }

      normalizeDate(entry.season_start_sunday);
      normalizeDate(entry.lane_date);
    });
  });
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

async function insertLeagueRegistration(
  payload: LeagueBookPayload,
  pricing: PricingResult
): Promise<LeagueRegistrationRow> {
  const { data, error } = await supabase
    .schema("texaxes")
    .from("league_registrations")
    .insert({
      season_label: payload.season_label,
      season_start_sunday: payload.season_start_sunday,
      registration_source: payload.registration_source || "public",
      player_count: payload.players.length,
      registration_count: pricing.registration_count,
      base_total: pricing.base_total,
      savings_total: pricing.savings_total,
      subtotal: pricing.subtotal,
      tax_amount: pricing.tax_amount,
      total_amount: pricing.total_amount,
      status: "awaiting_payment",
      payment_status: "pending",
      pricing_snapshot: pricing,
      payload_snapshot: payload,
    })
    .select("id")
    .single<LeagueRegistrationRow>();

  if (error || !data) {
    throw error || new Error("League registration insert failed");
  }

  return data;
}

async function insertLeaguePlayers(
  registrationId: string,
  players: LeaguePlayerPayload[]
): Promise<LeaguePlayerRow[]> {
  const insertRows = players.map((player, index) => ({
    league_registration_id: registrationId,
    player_order: index,
    first_name: player.first_name.trim(),
    last_name: player.last_name.trim(),
    email: normalizeEmail(player.email),
    phone: normalizePhone(player.phone),
    experience_level: player.experience_level || null,
    notes: player.notes || null,
    marketing_opt_in: Boolean(player.marketing_opt_in),
  }));

  const { data, error } = await supabase
    .schema("texaxes")
    .from("league_players")
    .insert(insertRows)
    .select("id");

  if (error || !data) {
    throw error || new Error("League players insert failed");
  }

  return data as LeaguePlayerRow[];
}

async function insertLeagueEntries(
  registrationId: string,
  leaguePlayers: LeaguePlayerRow[],
  payloadPlayers: LeaguePlayerPayload[],
  pricing: PricingResult
): Promise<LeagueEntryRow[]> {
  const pricingMap = new Map<string, PriceRow>();
  pricing.rows.forEach((row) => {
    pricingMap.set(`${row.player_index}:${row.entry_index}`, row);
  });

  const entryRows = payloadPlayers.flatMap((player, playerIndex) => {
    const leaguePlayerId = leaguePlayers[playerIndex]?.id;
    if (!leaguePlayerId) {
      throw new Error(`Missing inserted league player row for player ${playerIndex}`);
    }

    return player.entries.map((entry, entryIndex) => {
      const priced = pricingMap.get(`${playerIndex}:${entryIndex}`);
      if (!priced) {
        throw new Error(
          `Missing pricing row for player ${playerIndex} entry ${entryIndex}`
        );
      }

      return {
        league_registration_id: registrationId,
        league_player_id: leaguePlayerId,
        entry_order: entryIndex,
        discipline: entry.discipline,
        season_label: entry.season_label,
        season_start_sunday: entry.season_start_sunday,
        lane_label: entry.lane_label,
        lane_date: entry.lane_date,
        lane_time: entry.lane_time,
        base_price: priced.base,
        discount_index: priced.discount_index,
        discount_rate: priced.discount_rate,
        discount_amount: priced.discount_amount,
        final_price: priced.final_price,
      };
    });
  });

  const { data, error } = await supabase
    .schema("texaxes")
    .from("league_entries")
    .insert(entryRows)
    .select("id");

  if (error || !data) {
    throw error || new Error("League entries insert failed");
  }

  return data as LeagueEntryRow[];
}

async function updateRegistrationStripeSession(
  registrationId: string,
  checkoutSessionId: string
): Promise<void> {
  const { error } = await supabase
    .schema("texaxes")
    .from("league_registrations")
    .update({
      stripe_checkout_session_id: checkoutSessionId,
    })
    .eq("id", registrationId);

  if (error) {
    throw error;
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
    const payload = req.body as LeagueBookPayload;
    validatePayload(payload);

    const pricing = computeLeagueSessionPricing(payload.players);

    if (pricing.registration_count <= 0) {
      return badRequest(res, "No league registrations selected");
    }

    const registration = await insertLeagueRegistration(payload, pricing);
    const leaguePlayers = await insertLeaguePlayers(registration.id, payload.players);
    await insertLeagueEntries(
      registration.id,
      leaguePlayers,
      payload.players,
      pricing
    );

    const primaryEmail =
      normalizeEmail(payload.players[0]?.email) || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: primaryEmail,
      metadata: {
        league_registration_id: registration.id,
        registration_source: payload.registration_source || "public",
        season_label: payload.season_label,
        player_count: String(payload.players.length),
        registration_count: String(pricing.registration_count),
      },
      payment_intent_data: {
        metadata: {
          league_registration_id: registration.id,
          registration_source: payload.registration_source || "public",
          season_label: payload.season_label,
          player_count: String(payload.players.length),
          registration_count: String(pricing.registration_count),
        },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tex Axes League Registration",
              description: `${payload.season_label} · ${pricing.registration_count} registration(s) · ${payload.players.length} player(s)`,
            },
            unit_amount: Math.round(pricing.total_amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/success?league_registration_id=${registration.id}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel?league_registration_id=${registration.id}`,
    });

    await updateRegistrationStripeSession(registration.id, session.id);

    await writeAuditLog("league_registration_created", "league_registration", registration.id, {
      league_registration_id: registration.id,
      season_label: payload.season_label,
      season_start_sunday: payload.season_start_sunday,
      player_count: payload.players.length,
      registration_count: pricing.registration_count,
      base_total: pricing.base_total,
      savings_total: pricing.savings_total,
      subtotal: pricing.subtotal,
      tax_amount: pricing.tax_amount,
      total_amount: pricing.total_amount,
      registration_source: payload.registration_source || "public",
      stripe_checkout_session_id: session.id,
    });

    return res.status(200).json({
      league_registration_id: registration.id,
      checkout_url: session.url,
      totals: {
        registration_count: pricing.registration_count,
        base_total: pricing.base_total,
        savings_total: pricing.savings_total,
        subtotal: pricing.subtotal,
        tax_amount: pricing.tax_amount,
        total_amount: pricing.total_amount,
      },
      pricing_rows: pricing.rows,
    });
  } catch (error: any) {
    console.error("POST /api/league-book failed", error);
    return res.status(500).json({
      error: error?.message || "League booking failed",
    });
  }
}
