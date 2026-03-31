export function buildWaiverEmail(params: {
  firstName: string;
  waiverUrl: string;
  bookingDate?: string;
  bookingTime?: string;
}) {
  const formattedDateTime =
    params.bookingDate && params.bookingTime
      ? `${params.bookingDate} at ${params.bookingTime.slice(0, 5)}`
      : null;

  const subject = "Complete Your Tex Axes Waiver";

  const text = [
    `Hi ${params.firstName || "there"},`,
    "",
    "Please complete your Tex Axes waiver before arrival.",
    formattedDateTime ? `Booking time: ${formattedDateTime}` : null,
    "",
    params.waiverUrl,
    "",
    "If the waiver is for a minor participant, a parent or legal guardian must complete it.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 16px;">Complete Your Waiver</h2>
      <p>Hi ${params.firstName || "there"},</p>
      <p>Please complete your Tex Axes waiver before arrival.</p>
      ${formattedDateTime ? `<p><strong>Booking time:</strong> ${formattedDateTime}</p>` : ""}
      <p>
        <a href="${params.waiverUrl}" style="display:inline-block;padding:12px 18px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
          Complete Waiver
        </a>
      </p>
      <p style="word-break:break-all;color:#4b5563;">${params.waiverUrl}</p>
      <p>If the waiver is for a minor participant, a parent or legal guardian must complete it.</p>
    </div>
  `;

  return { subject, text, html };
}
