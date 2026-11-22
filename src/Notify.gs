/**
 * All system emails.
 *  - Status updates to the employee (filed, each signature, reopen, completion) go to ONE Gmail
 *    thread per clearance, cc the Immediate Supervisor (+ clearance@ outside TEST_MODE).
 *  - Not Cleared / pending case / Hold open their own threads, with the Supervisor looped in.
 *  - Officer "Action needed" emails cc alternates (+ clearance@ outside TEST_MODE).
 */

function webAppUrl_() {
  return setting_('WEBAPP_URL') || ScriptApp.getService().getUrl();
}

function portalUrl_(ref) {
  return `${webAppUrl_()}?page=officer${ref ? '&ref=' + encodeURIComponent(ref) : ''}`;
}

function subject_(text) {
  return `[E-Clearance${ECL.TEST_MODE ? ' TEST' : ''}] ${text}`;
}

/** Sends a branded email; cc is de-duplicated and never repeats a "to" address. */
function sendMail_(to, subject, title, inner, opts) {
  const o = opts || {};
  const toList = String(to).toLowerCase().split(',').map((s) => s.trim());
  const cc = Array.from(new Set((o.cc || []).map((e) => String(e || '').toLowerCase().trim())))
    .filter((e) => e && toList.indexOf(e) < 0);
  const options = { htmlBody: brandedEmail_(title, inner), name: ECL.SENDER_NAME };
  if (cc.length) options.cc = cc.join(',');
  if (o.replyTo) options.replyTo = o.replyTo;
  GmailApp.sendEmail(to, subject, '', options);
}

/** Supervisor + clearance@ (outside test mode). */
function standardCc_(req) {
  return [req['Supervisor Email']].concat(copyList_());
}

function hrmddReplyTo_() {
  return ECL.TEST_MODE ? ECL.HOST_EMAIL : ECL.CLEARANCE_GROUP;
}

function employeeRows_(req) {
  const purpose = req.Purpose === 'Other Mode of Separation' ? `Other: ${req['Other Purpose']}` : req.Purpose;
  return [
    ['Reference No.', req['Ref No']], ['Employee', req['Employee Name (HRIS)']],
    ['Position/SG/Step', req['Position/SG/Step']], ['Office of Assignment', req['Office of Assignment']],
    ['Purpose', purpose], ['Date of Effectivity', formatLongDate_(req['Date of Effectivity'])],
  ];
}

/* ------------------------------------------------------------------ update thread */

/** RFC 2047 encoding for non-ASCII header text (names, em dashes). */
function mimeHeader_(text) {
  return /^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${Utilities.base64Encode(text, Utilities.Charset.UTF_8)}?=`;
}

/**
 * Sends an HTML email through the Gmail API so it can be placed in an existing thread.
 * Returns { id, threadId, messageId } where messageId is the RFC Message-ID header.
 */
function sendRaw_(o) {
  const headers = [
    `From: ${mimeHeader_(ECL.SENDER_NAME)} <${ECL.HOST_EMAIL}>`,
    `To: ${o.to}`,
    o.cc && o.cc.length ? `Cc: ${o.cc.join(', ')}` : '',
    o.replyTo ? `Reply-To: ${o.replyTo}` : '',
    `Subject: ${mimeHeader_(o.subject)}`,
    o.inReplyTo ? `In-Reply-To: ${o.inReplyTo}` : '',
    o.inReplyTo ? `References: ${o.inReplyTo}` : '',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].filter(String);
  const body = Utilities.base64Encode(o.html, Utilities.Charset.UTF_8).replace(/(.{76})/g, '$1\r\n');
  const raw = Utilities.base64EncodeWebSafe(headers.join('\r\n') + '\r\n\r\n' + body);
  const resource = { raw };
  if (o.threadId) resource.threadId = o.threadId;
  const sent = Gmail.Users.Messages.send(resource, 'me');
  const meta = Gmail.Users.Messages.get('me', sent.id, { format: 'metadata', metadataHeaders: ['Message-Id'] });
  const h = ((meta.payload && meta.payload.headers) || []).find((x) => /^message-id$/i.test(x.name));
  return { id: sent.id, threadId: sent.threadId, messageId: h ? h.value : '' };
}

/**
 * Adds a status update to the clearance's single update thread (starts it on first use).
 * `req` is a Requests record from readObjects_ (needs _row).
 */
function sendUpdate_(req, title, inner) {
  const base = subject_(`Clearance updates: ${req['Employee Name (HRIS)']} (${req['Ref No']})`);
  const threadId = req['Update Thread ID'] || '';
  const first = req['Update Message ID'] || '';
  const cc = Array.from(new Set(standardCc_(req).map((e) => String(e || '').toLowerCase()).filter(Boolean)))
    .filter((e) => e !== String(req['Personal Email']).toLowerCase());
  const res = sendRaw_({
    to: req['Personal Email'], cc, replyTo: hrmddReplyTo_(),
    subject: first ? `Re: ${base}` : base,
    html: brandedEmail_(title, inner), threadId, inReplyTo: first,
  });
  if (!first) {
    updateRow_('Requests', req._row, { 'Update Thread ID': res.threadId, 'Update Message ID': res.messageId });
    req['Update Thread ID'] = res.threadId;
    req['Update Message ID'] = res.messageId;
  }
}

/* ------------------------------------------------------------------ to signatories */

/** One email per officer listing all of their rows that are now due (e.g. 3 rows for one officer). */
function notifyOfficers_(req, sigs, due, opts) {
  const o = opts || {};
  const byOfficer = {};
  sigs.forEach((s) => (byOfficer[s['Officer Email']] = byOfficer[s['Officer Email']] || []).push(s));

  Object.keys(byOfficer).forEach((email) => {
    const rows = byOfficer[email];
    const parts = Array.from(new Set(rows.map((s) => s.Part)));
    const deemed = parts.every((p) => DEEMED_PARTS.indexOf(p) >= 0);
    const offices = rows.map((s) => `Part ${s.Part} &middot; ${escapeHtml_(s.Office)}`).join('<br>');

    const inner = `
<p>Dear <b>${escapeHtml_(rows[0]['Officer Name'])}</b>,</p>
${o.reopenReason ? `<div style="background:#fff8e1; border-left:5px solid ${ECL.BRAND.GOLD}; padding:12px; margin-bottom:12px;">
<b>Reopened by HRMDD.</b> Reason: ${escapeHtml_(o.reopenReason)}</div>` : ''}
<p>The clearance below is now due for your action.</p>
${detailsTable_(employeeRows_(req))}
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
  <tr style="background-color: #f2f2f2;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 40%;">For your action</td>
    <td style="padding: 10px; border: 1px solid #ddd;">${offices}</td></tr>
  <tr><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Please act by</td>
    <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; color: ${ECL.BRAND.NAVY};">${formatLongDate_(due)}
    <span style="font-weight: normal; color: #555;">(3 working days)</span></td></tr>
</table>
<p style="font-size: 14px;">${deemed
    ? 'If no action is recorded by then, the employee will be <b>deemed cleared</b> by your office (MC-2026-014 &sect;III.E). If you are on official business, leave or travel, you may extend this to 7 working days in the portal.'
    : 'Please act within three (3) working days (MC-2026-014 &sect;III.B.2).'}</p>
${linkButton_(portalUrl_(req['Ref No']), 'Open in E-Clearance Portal')}
${portalNoteHtml_()}`;

    // The Supervisor follows progress in the single update thread instead of every request.
    const cc = rows.map((s) => s['Alternate Email']).concat(copyList_());
    sendMail_(email, subject_(`Action needed: ${req['Employee Name (HRIS)']} (${req['Ref No']})`),
      'Clearance Request', inner, { cc });
  });
}

/* ------------------------------------------------------------------ to the employee */

function notifySigned_(req, sig, def) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>A signatory has acted on your clearance (${req['Ref No']}).</p>
${detailsTable_([
  ['Reference No.', req['Ref No']], ['Office', `Part ${sig.Part} — ${sig.Office}`],
  ['Signatory', sig['Officer Name']], ['Action', def.label], ['Date', fmtDateTime_(sig['Action At'])],
])}
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  sendUpdate_(req, `${def.label}: ${sig.Office}`, inner);
}

/** Not Cleared / pending case / investigation: direct thread between employee and officer. */
function notifyAccountability_(req, sig, def, actor) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>Your clearance (${req['Ref No']}) was marked <b>${def.label}</b> by
<b>${escapeHtml_(sig.Office)}</b>. The details are below.</p>
<div style="background:#fdecea; border-left:5px solid #B3261E; padding:12px; white-space:pre-wrap;">${escapeHtml_(sig.Details)}</div>
<p>Please coordinate directly with the clearing officer by <b>replying to this email</b>
(MC-2026-014 &sect;III.D.1). Once settled, the officer will record your clearance in the E-Clearance Portal.</p>
<p style="font-size: 14px; color: #555;">Accountabilities still unsettled 30 days after separation may be
deducted from your remaining pay (MC-2026-014 &sect;III.D.3).</p>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  const cc = [sig['Officer Email'], sig['Alternate Email'], actor].concat(standardCc_(req));
  sendMail_(req['Personal Email'], subject_(`${def.label}: ${sig.Office} (${req['Ref No']})`),
    def.label, inner, { cc, replyTo: actor });
}

/** Part V Hold: remarks go to the employee and HRMDD. */
function notifyHold_(req, sig, actor) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>The final certification of your clearance (${req['Ref No']}) has been placed <b>on hold</b> by
${escapeHtml_(sig['Officer Name'])}. The remarks are below.</p>
<div style="background:#fdecea; border-left:5px solid #B3261E; padding:12px; white-space:pre-wrap;">${escapeHtml_(sig.Details)}</div>
<p>HRMDD will coordinate with you on the next steps. You may reply to this email.</p>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  const cc = [actor, sig['Officer Email']].concat(settingList_('HRMDD_ADMINS'), standardCc_(req));
  sendMail_(req['Personal Email'], subject_(`Certification on hold (${req['Ref No']})`),
    'Certification On Hold', inner, { cc, replyTo: hrmddReplyTo_() });
}

function notifyReopened_(req, sig, reason) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>HRMDD has reopened <b>${escapeHtml_(sig.Office)}</b> on your clearance (${req['Ref No']}) and sent it back
to the signatory for action.</p>
<div style="background:#fff8e1; border-left:5px solid ${ECL.BRAND.GOLD}; padding:12px; white-space:pre-wrap;">${escapeHtml_(reason)}</div>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  sendUpdate_(req, 'Clearance Reopened', inner);
}

function notifyCompleted_(req) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>All signatories have acted on your clearance (${req['Ref No']}), including the final certification
by the Acting Executive Vice President.</p>
<p>HRMDD will issue the final electronic clearance (PDF with a verification QR code) and send it to
this email address.</p>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  sendUpdate_(req, 'All Signatures Complete', inner);
}

/** First message of the update thread. */
function sendFiledNotice_(req) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>The HRMDD has filed your clearance (CS Form No. 7) for processing under MC-2026-014,
<i>Electronic Clearance Processing</i>.</p>
${detailsTable_(employeeRows_(req).concat([['Date of Filing', formatLongDate_(req['Date of Filing'])]]))}
<p><b>What happens next</b></p>
<ol style="padding-left: 20px; line-height: 1.6;">
  <li><b>Part II:</b> your Immediate Supervisor, then your Head of Office</li>
  <li><b>Part III:</b> all clearing offices, at the same time</li>
  <li><b>Part IV:</b> Certification of No Pending Administrative Case</li>
  <li><b>Part V:</b> Certification by the Acting Executive Vice President</li>
</ol>
<p>Every signature will be posted <b>in this email thread</b>. You can also follow your clearance in
real time on your live form: the Part currently being processed is highlighted in gold, and completed
Parts in green.</p>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}
<p style="font-size: 14px; color: #555;">If a clearing office notes an accountability, you will be put in
direct contact with that office in a separate email. Please settle accountabilities promptly; those
unsettled 30 days after separation may be deducted from your remaining pay (MC-2026-014 &sect;III.D.3).</p>`;
  sendUpdate_(req, 'Clearance Filed', inner);
}
