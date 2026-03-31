export function buildBookingInternalEmail(params: {
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
}) {
  const subject = `New Tex Axes Booking — ${params.date} ${params.time.slice(0, 5)}`;

  const text = [
    "New Tex Axes booking created.",
    "",
    `Booking ID: ${params.bookingId}`,
    `Customer: ${params.customerName}`,
    `Email: ${params.customerEmail || "none"}`,
    `Phone: ${params.customerPhone || "none"}`,
    `Date: ${params.date}`,
    `Time: ${params.time.slice(0, 5)}`,
    `Party Size: ${params.partySize}`,
    `Total: $${params.totalAmount.toFixed(2)}`,
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
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 16px;">New Tex Axes Booking</h2>
      <p>
        <strong>Booking ID:</strong> ${params.bookingId}<br />
        <strong>Customer:</strong> ${params.customerName}<br />
        <strong>Email:</strong> ${params.customerEmail || "none"}<br />
        <strong>Phone:</strong> ${params.customerPhone || "none"}<br />
        <strong>Date:</strong> ${params.date}<br />
        <strong>Time:</strong> ${params.time.slice(0, 5)}<br />
        <strong>Party Size:</strong> ${params.partySize}<br />
        <strong>Total:</strong> $${params.totalAmount.toFixed(2)}<br />
        <strong>Source:</strong> ${params.bookingSource}<br />
        <strong>Type:</strong> ${params.bookingType}<br />
        <strong>Tax Exempt:</strong> ${params.taxExempt ? "Yes" : "No"}
      </p>
      ${params.taxExemptReason ? `<p><strong>Tax Exempt Reason:</strong> ${params.taxExemptReason}</p>` : ""}
      ${params.customerNotes ? `<p><strong>Customer Notes:</strong><br />${params.customerNotes.replace(/\n/g, "<br />")}</p>` : ""}
      ${params.internalNotes ? `<p><strong>Internal Notes:</strong><br />${params.internalNotes.replace(/\n/g, "<br />")}</p>` : ""}
    </div>
  `;

  return { subject, text, html };
}
