import express from "express";
import cors from "cors";
import Stripe from "stripe";

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// CONFIG
// =============================
const PORT = process.env.PORT || 3001;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2024-06-20",
});

// Venue config
const TOTAL_BAYS = 4;
const PREFERRED_THROWERS_PER_BAY = 4;
const MAX_THROWERS_PER_BAY = 6;

const PRICE_PER_THROWER = 29;
const TAX_RATE = 0.0825;

// Add-ons
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
  0: { start: 12, end: 20 }, // Sunday
  1: null, // Monday CLOSED
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
  const preferred = Math.ceil(throwers / PREFERRED_THROWERS_PER_BAY);
  const minimum = Math.ceil(throwers / MAX_THROWERS_PER_BAY);
  return { preferred, minimum };
}

// ⚠️ TEMP: replace with DB query later
function getOpenBaysForSlot(_date: string, _time: string) {
  // placeholder: assume empty schedule
  return TOTAL_BAYS;
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

    const result = slots.map((slot) => {
      const openBays = getOpenBaysForSlot(date, slot.start);

      if (!throwers) {
        return {
          ...slot,
          open_bays: openBays,
        };
      }

      const { preferred, minimum } = computeBayRequirements(Number(throwers));

      let state = "available";
      if (openBays >= preferred) {
        state = "available";
      } else if (openBays >= minimum) {
        state = "limited";
      } else {
        state = "full";
      }

      return {
        ...slot,
        open_bays: openBays,
        preferred_bays_required: preferred,
        minimum_bays_required: minimum,
        state,
      };
    });

    res.json({
      date,
      throwers: throwers || null,
      slots: result,
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
        error: "Group too large. Please contact for full venue booking.",
      });
    }

    const slots = getSlotsForDate(date);
    const validSlot = slots.find((s) => s.start === time);

    if (!validSlot) {
      return res.status(400).json({ error: "Invalid time slot" });
    }

    const openBays = getOpenBaysForSlot(date, time);

    const { preferred, minimum } = computeBayRequirements(throwers);

    if (openBays < minimum) {
      return res.status(400).json({
        error: "Slot not available",
      });
    }

    const pricing = computePrice(payload);

    // ⚠️ TODO: persist booking in DB (Supabase)

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
      success_url: `${process.env.FRONTEND_URL}/success`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    res.json({
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
