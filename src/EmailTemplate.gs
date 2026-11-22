/**
 * DAP-branded HTML email shell (navy header with logo, gold rule, grey footer).
 */
function brandedEmail_(title, innerHtml, footerNote) {
  const B = ECL.BRAND;
  return `
<div style="font-family: Arial, sans-serif; font-size: 16px; color: #333; max-width: 600px; margin: auto; border: 1px solid #ddd;">
  <div style="background-color: ${B.NAVY}; padding: 20px; text-align: center;">
    <img src="${B.LOGO}" alt="DAP Logo" style="width: 400px; max-width: 100%;">
  </div>
  <div style="padding: 25px; border-top: 5px solid ${B.GOLD};">
    <h2 style="color: ${B.NAVY}; text-align: center; font-size: 22px; text-transform: uppercase;">${title}</h2>
    ${innerHtml}
    <p style="margin-top: 30px;">Thank you,</p>
    <p><b>Human Resource Management and Development Department</b></p>
  </div>
  <div style="text-align: center; font-size: 12px; color: #777; padding: 15px; background-color: #f9f9f9; border-top: 1px solid #ddd;">
    <p>${footerNote || 'This is an automated notification from the DAP E-Clearance System.'}</p>
  </div>
</div>`;
}

/** Key/value table in the house style. rows = [[label, value], ...] */
function detailsTable_(rows) {
  const tr = rows.map(([k, v], i) => `
    <tr${i % 2 === 0 ? ' style="background-color: #f2f2f2;"' : ''}>
      <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 40%;">${k}</td>
      <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml_(v)}</td>
    </tr>`).join('');
  return `<table style="width: 100%; border-collapse: collapse; margin: 20px 0;">${tr}</table>`;
}

/** A bulletproof (table-based) email button pointing at a mailto: link. */
function emailButton_(href, text, color) {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" style="display: inline-table; margin: 4px 6px 4px 0;">
  <tr><td style="background-color: ${color}; border-radius: 5px;">
    <a href="${href}" target="_blank"
       style="display: inline-block; padding: 10px 16px; color: #ffffff; font-weight: bold; font-size: 14px; text-decoration: none; border-radius: 5px;">${text}</a>
  </td></tr>
</table>`;
}

/** One signatory row card: office name + the button set for its Part. */
function rowCard_(ref, row, officerEmail) {
  const code = makeCode_(ref, row.rowId, officerEmail);
  const buttons = BUTTON_SETS[row.part]
    .map((a) => emailButton_(buildMailto_(ref, row.rowId, a, code), ACTIONS[a].button, ACTIONS[a].color))
    .join('');
  return `
<div style="border: 1px solid #ddd; border-left: 5px solid ${ECL.BRAND.GOLD}; padding: 14px; margin: 14px 0; border-radius: 4px;">
  <div style="font-size: 12px; color: #777; text-transform: uppercase;">Part ${row.part} &middot; Row ${row.rowId}</div>
  <div style="font-weight: bold; color: ${ECL.BRAND.NAVY}; margin: 4px 0 10px;">${escapeHtml_(row.office)}</div>
  ${buttons}
</div>`;
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * "How to respond" box for officer request emails, including the MC-2026-014 §III.B.4
 * reminder that a notice of accountability must be specific.
 */
function officerInstructionsHtml_() {
  return `
<p style="background:#fff8e1; border:1px solid ${ECL.BRAND.GOLD}; padding:12px; border-radius:4px; font-size:14px;">
<b>How to respond:</b> click a button below. Gmail opens a pre-filled email &mdash; just press <b>Send</b>.<br><br>
For <b>Not Cleared</b>, <b>Hold</b> or a pending case, type the details at the top of that email first.
Please be specific: name the <b>item or accountability</b> (e.g., property number, amount, document)
and the <b>action the employee must take</b> to be cleared (MC-2026-014 &sect;III.B.4).<br><br>
Please do not edit the code block at the bottom of the email.</p>`;
}

/** Table-based button for ordinary web links. */
function linkButton_(href, text) {
  return `
<p style="text-align: center; margin: 25px 0;">
  <a href="${href}" target="_blank"
     style="background-color: ${ECL.BRAND.GOLD}; color: ${ECL.BRAND.NAVY}; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">${text}</a>
</p>`;
}
