// stripe-webhook.ts
import Stripe from "stripe";
import express from "express";
import bodyParser from "body-parser";
import { createClient } from "@supabase/supabase-js";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Stripe requires raw body
app.post(
  "/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;

      const holdId = pi.metadata.hold_id;
      const customerId = pi.metadata.customer_id;
      const partySize = Number(pi.metadata.party_size);

      if (!holdId || !customerId || !partySize) {
        return res.status(400).send("Missing metadata");
      }

      const { error } = await supabase.rpc(
        "finalize_booking_from_hold",
        {
          p_hold_id: holdId,
          p_customer_id: customerId,
          p_party_size: partySize,
          p_booking_type: "open",
          p_stripe_payment_id: pi.id,
          p_amount_cents: pi.amount_received,
        }
      );

      // Duplicate webhook = safe ignore
      if (error && !error.message.includes("duplicate")) {
        console.error(error);
        return res.status(500).send("Finalize failed");
      }
    }

    res.json({ received: true });
  }
);

app.listen(3000, () => {
  console.log("Tex Axes Stripe webhook listening on port 3000");
});
