import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// =============================
// SERVICES
// =============================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// =============================
// CONFIG
// =============================
const TOTAL_BAYS = 4;
const PREFERRED_THROWERS_PER_BAY = 4;
const MAX_THROWERS_PER_BAY = 6;

const PRICE_PER_THROWER = 29;
const TAX_RATE = 0.0825;

const ADDONS = {
  byob: 5,
  wktlKnife: 20,
  proAxe: 10,
  bigAxe: 15,
  shovel: 20,
};

// =============================
// HOURS
// =============================
const HOURS: Record<number, { start: number; end: number } | null> = {
  0: { start: 12, end: 20 },
  1: null,
  2: { start: 16, end: 22 },
  3: { start: 16, end: 22 },
  4: { start: 16, end: 22 },
  5: { start: 16, end: 23 },
  6: { start: 12, end: 23 },
};

// =============================
// HELPERS
// =============================
function getSlotsForDate(dateStr: string) {
  const date = new Date(dateStr);
  const day = date.getDay();
  const hours = HOURS[day];

  if (!hours) return [];

  const slots = [];
  for (let h = hours.start; h < hours.end; h++) {
    slots.push({
      start: `${String(h).padStart(2, "0")}:00`,
      end: `${String(h + 1).padStart(2, "0")}:00`,
    });
  }

  return slots;
}

function computeBayRequirements(throwers: number) {
  return {
    preferred: Math.ceil(throwers / PREFERRED_THROWERS_PER_BAY),
    minimum: Math.ceil(throwers / MAX_THROWERS_PER_BAY),
  };
}

async function getOpenBaysForSlot(date: string, time: string) {
  const { data, error } = await supabase
    .from("bookings")
    .select("bays_used, status")
    .eq("date", date)
    .eq("time", time);

  if (error) {
    console.error("Supabase error:", error);
    throw new Error("DB error");
  }

  const usedBays = (data || [])
    .filter((b) =>
      ["paid", "awaiting_payment", "reserved"].includes(b.status)
    )
    .reduce((sum, b) => sum + (b.bays_used || 0), 0);

  return TOTAL_BAYS - usedBays;
}

function computePrice(payload: any) {
  const base = payload.throwers * PRICE_PER_THROWER;

  const byob = (payload.addons?.byob_guests || 0) * ADDONS.byob;
  const knife = (payload.addons?.wktl_knife_rental_qty || 0) * ADDONS.wktlKnife;
  const proAxe = (payload.addons?.pro_axe_qty || 0) * ADDONS.proAxe;
  const bigAxe = (payload.addons?.big_axe_qty || 0) * ADDONS.bigAxe;
  const shovel = (payload.addons?.shovel_qty || 0) * ADDONS.shovel;

  const subtotal = base + byob + knife + proAxe + bigAxe + shovel;
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;

  return { subtotal, tax, total };
}

// =============================
// AVAILABILITY
// =============================
app.get("/availability", async (req, res) => {
  try {
    const { date, throwers } = req.query as any;

    if (!date) {
      return res.status(400).json({ error: "Missing date" });
    }

    const slots = getSlotsForDate(date);

    const results = [];

    for (const slot of slots) {
      const openBays = await getOpenBaysForSlot(date, slot.start);

      if (!throwers) {
        results.push({
          ...slot,
          open_bays: openBays,
        });
        continue;
      }

      const { preferred, minimum } = computeBayRequirements(
        Number(throwers)
      );

      let state = "available";

      if (openBays >= preferred) {
        state = "available";
      } else if (openBays >= minimum) {
        state = "limited";
      } else {
        state = "full";
      }

      results.push({
        ...slot,
        open_bays: openBays,
        preferred_bays_required: preferred,
        minimum_bays_required: minimum,
        state,
      });
    }

    res.json({
      date,
      throwers: throwers || null,
      slots: results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Availability failed" });
  }
});

// =============================
// BOOK
// =============================
app.post("/book", async (req, res) => {
  try {
    const payload = req.body;
    const { date, time, throwers } = payload;

    if (!date || !time || !throwers) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (throwers > 24) {
      return res.status(400).json({
        error: "Group too large. Contact for full venue booking.",
      });
    }

    const slots = getSlotsForDate(date);
    if (!slots.find((s) => s.start === time)) {
      return res.status(400).json({ error: "Invalid slot" });
    }

    const openBays = await getOpenBaysForSlot(date, time);

    const { preferred, minimum } = computeBayRequirements(throwers);

    if (openBays < minimum) {
      return res.status(400).json({
        error: "Slot no longer available",
      });
    }

    const baysUsed = openBays >= preferred ? preferred : minimum;

    const pricing = computePrice(payload);

    // =============================
    // INSERT BOOKING
    // =============================
    const { data: booking, error: insertError } = await supabase
      .from("bookings")
      .insert({
        date,
        time,
        throwers,
        bays_used: baysUsed,
        status: "awaiting_payment",
        total_amount: pricing.total,
      })
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return res.status(500).json({ error: "Booking insert failed" });
    }

    // =============================
    // STRIPE
    // =============================
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Tex Axes Booking",
            },
            unit_amount: Math.round(pricing.total * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: booking.id,
      },
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    res.json({
      booking_id: booking.id,
      checkout_url: session.url,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Booking failed" });
  }
});

// =============================
app.listen(PORT, () => {
  console.log(`Tex Axes Ops running on ${PORT}`);
});
