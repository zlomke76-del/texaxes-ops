import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false,
  },
};

async function writeAuditLog(
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
  actorType: "system" | "admin" | "customer" | "webhook" = "webhook"
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

async function readRawBody(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function markBookingPaid(
  bookingId: string,
  paymentId: string | null,
  paymentIntentId: string,
  checkoutSessionId: string | null,
  amountReceivedCents: number
): Promise<void> {
  const amountReceived = amountReceivedCents / 100;

  if (paymentId) {
    const { error: paymentError } = await supabase
      .schema("texaxes")
      .from("payments")
      .update({
        status: "paid",
        external_payment_id: paymentIntentId,
        external_checkout_id: checkoutSessionId,
        paid_at: new Date().toISOString(),
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
          paid_at: new Date().toISOString(),
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

  await writeAuditLog("booking_paid", "booking", bookingId, {
    booking_id: bookingId,
    payment_id: paymentId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_checkout_session_id: checkoutSessionId,
    amount_received_cents: amountReceivedCents,
  });
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

  await writeAuditLog("league_registration_paid", "league_registration", registrationId, {
    league_registration_id: registrationId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_checkout_session_id: checkoutSessionId,
    amount_received_cents: amountReceivedCents,
  });
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
    await writeAuditLog("payment_failed", "booking", bookingId, {
      booking_id: bookingId,
      payment_id: paymentId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_checkout_session_id: checkoutSessionId,
      error: lastPaymentError,
    });
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

  await writeAuditLog("league_payment_failed", "league_registration", registrationId, {
    league_registration_id: registrationId,
    stripe_payment_intent_id: paymentIntentId,
    stripe_checkout_session_id: checkoutSessionId,
    error: lastPaymentError,
  });
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

  await writeAuditLog("booking_expired", "booking", bookingId, {
    booking_id: bookingId,
    payment_id: paymentId,
    stripe_checkout_session_id: checkoutSessionId,
  });
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

  await writeAuditLog("league_registration_expired", "league_registration", registrationId, {
    league_registration_id: registrationId,
    stripe_checkout_session_id: checkoutSessionId,
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    return res.status(400).send("Missing stripe-signature header");
  }

  try {
    const rawBody = await readRawBody(req);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );
    } catch (err: any) {
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
