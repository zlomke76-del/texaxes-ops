export function buildMarketingEmail(params: {
  subject: string;
  heading: string;
  bodyHtml: string;
  previewText?: string;
}) {
  const text = `${params.heading}\n\nView this email in HTML format.`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;max-width:640px;margin:0 auto;">
      ${
        params.previewText
          ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${params.previewText}</div>`
          : ""
      }
      <h1 style="margin:0 0 16px;">${params.heading}</h1>
      <div>${params.bodyHtml}</div>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
      <p style="font-size:12px;color:#6b7280;">
        You are receiving this because you opted in to updates from Tex Axes.
      </p>
    </div>
  `;

  return {
    subject: params.subject,
    text,
    html,
  };
}
