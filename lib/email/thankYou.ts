export function buildThankYouEmail(params: {
  firstName: string;
  couponCode: string;
  discountLabel?: string;
  validDays?: number;
}) {
  const discountLabel = params.discountLabel || "20% off";
  const validDays = params.validDays ?? 30;

  const subject = "Thanks for visiting Tex Axes";

  const text = [
    `Hi ${params.firstName || "there"},`,
    "",
    "Thanks for throwing with us at Tex Axes.",
    "We hope you had a great time.",
    "",
    `As a thank you, here is ${discountLabel} your next visit.`,
    `Use code: ${params.couponCode}`,
    `Valid for ${validDays} days.`,
    "",
    "We look forward to seeing you again soon.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;">
      <h2 style="margin:0 0 16px;">Thanks for visiting Tex Axes</h2>
      <p>Hi ${params.firstName || "there"},</p>
      <p>Thanks for throwing with us at <strong>Tex Axes</strong>.</p>
      <p>We hope you had a great time.</p>
      <p>As a thank you, here is <strong>${discountLabel}</strong> your next visit.</p>
      <p>
        Use code: <strong>${params.couponCode}</strong><br />
        Valid for ${validDays} days.
      </p>
      <p>We look forward to seeing you again soon.</p>
    </div>
  `;

  return { subject, text, html };
}
