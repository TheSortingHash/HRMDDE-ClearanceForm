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

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Help line for portal links (Apps Script web apps can fail when several Google accounts are signed in). */
function portalNoteHtml_() {
  return `<p style="font-size: 12px; color: #777; text-align: center;">If the portal shows an error, open the
link in a browser window signed in only to your DAP account (for example, a private/incognito window).</p>`;
}

/** Table-based button for ordinary web links. */
function linkButton_(href, text) {
  return `
<p style="text-align: center; margin: 25px 0;">
  <a href="${href}" target="_blank"
     style="background-color: ${ECL.BRAND.GOLD}; color: ${ECL.BRAND.NAVY}; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">${text}</a>
</p>`;
}
