export function buildBookingCustomerEmail(params: {
  customerName: string;
  bookingId: string;
  date: string;
  time: string;
  partySize: number;
  totalAmount: number;
  checkoutUrl?: string | null;
  waiverUrl: string;
}) {
  const subject = `Your Tex Axes booking for ${params.date} at ${params.time.slice(0, 5)}`;

  const text = [
    `Hi ${params.customerName},`,
    "",
    "Thanks for booking with Tex Axes.",
    "",
    `Booking ID: ${params.bookingId}`,
    `Date: ${params.date}`,
    `Time: ${params.time.slice(0, 5)}`,
    `Party Size: ${params.partySize}`,
    `Total: $${params.totalAmount.toFixed(2)}`,
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
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 16px;">Your Tex Axes Booking</h2>
      <p>Hi ${params.customerName},</p>
      <p>Thanks for booking with <strong>Tex Axes</strong>.</p>
      <p>
        <strong>Booking ID:</strong> ${params.bookingId}<br />
        <strong>Date:</strong> ${params.date}<br />
        <strong>Time:</strong> ${params.time.slice(0, 5)}<br />
        <strong>Party Size:</strong> ${params.partySize}<br />
        <strong>Total:</strong> $${params.totalAmount.toFixed(2)}
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

  return { subject, text, html };
}
