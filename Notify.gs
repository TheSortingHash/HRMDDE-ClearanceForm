/**
 * All system emails.
 *  - Status updates to the employee (filed, each signature, reopen, completion) go to ONE Gmail
 *    thread per clearance, cc the Immediate Supervisor (+ clearance@ outside TEST_MODE).
 *  - Not Cleared / pending case / Hold open their own threads, with the Supervisor looped in.
 *  - Officer "Action needed" emails cc alternates (+ clearance@ outside TEST_MODE).
 */

/**
 * The deployed web app URL (…/exec) used in every email link. Always set Settings → WEBAPP_URL:
 * when code runs from the editor (tests, setup), Google returns the /dev test URL, which only the
 * project's editors can open ("You need access").
 */
function webAppUrl_() {
  const set = String(setting_('WEBAPP_URL') || '').trim();
  if (set) return set;
  const auto = ScriptApp.getService().getUrl() || '';
  if (/\/dev$/.test(auto)) {
    console.warn('Settings → WEBAPP_URL is blank; email links fall back to the /dev test URL, which signatories cannot open.');
  }
  return auto;
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
  ].filter(String);
  const wrap = (b64) => b64.replace(/(.{76})/g, '$1\r\n');
  const htmlPart = ['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    wrap(Utilities.base64Encode(o.html, Utilities.Charset.UTF_8))].join('\r\n');
  let mime;
  if (o.attachments && o.attachments.length) {
    const boundary = 'ecl_' + Utilities.getUuid().replace(/-/g, '');
    const parts = [htmlPart].concat(o.attachments.map((b) => [
      `Content-Type: ${b.getContentType()}; name="${mimeHeader_(b.getName())}"`,
      `Content-Disposition: attachment; filename="${mimeHeader_(b.getName())}"`,
      'Content-Transfer-Encoding: base64', '', wrap(Utilities.base64Encode(b.getBytes()))].join('\r\n')));
    mime = headers.concat([`Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      parts.map((p) => `--${boundary}\r\n${p}`).join('\r\n'), `--${boundary}--`]).join('\r\n');
  } else {
    mime = headers.join('\r\n') + '\r\n' + htmlPart;
  }
  const raw = Utilities.base64EncodeWebSafe(mime);
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
function sendUpdate_(req, title, inner, attachments) {
  const base = subject_(`Clearance updates: ${req['Employee Name (HRIS)']} (${req['Ref No']})`);
  const threadId = req['Update Thread ID'] || '';
  const first = req['Update Message ID'] || '';
  const cc = Array.from(new Set(standardCc_(req).map((e) => String(e || '').toLowerCase()).filter(Boolean)))
    .filter((e) => e !== String(req['Personal Email']).toLowerCase());
  const res = sendRaw_({
    to: req['Personal Email'], cc, replyTo: hrmddReplyTo_(),
    subject: first ? `Re: ${base}` : base,
    html: brandedEmail_(title, inner), threadId, inReplyTo: first, attachments,
  });
  if (!first) {
    updateRow_('Requests', req._row, { 'Update Thread ID': res.threadId, 'Update Message ID': res.messageId });
    req['Update Thread ID'] = res.threadId;
    req['Update Message ID'] = res.messageId;
  }
}

/* ------------------------------------------------------------------ to signatories */

/**
 * One email per officer listing all of their rows (e.g. 3 rows for one officer).
 * opts.kind: 'REQUEST' (default) | 'REMINDER' | 'FINAL' (5 days before the 30-day deadline).
 * opts.reopenReason: shown when HRMDD reopened the row. opts.finalDeadline: Date for 'FINAL'.
 * `due` is used when a row has no Due At of its own.
 */
function notifyOfficers_(req, sigs, due, opts) {
  const o = opts || {};
  const kind = o.kind || 'REQUEST';
  const byOfficer = {};
  sigs.forEach((s) => (byOfficer[s['Officer Email']] = byOfficer[s['Officer Email']] || []).push(s));

  Object.keys(byOfficer).forEach((email) => {
    const rows = byOfficer[email];
    const deemed = rows.every((s) => DEEMED_PARTS.indexOf(s.Part) >= 0);
    const rowDue = (s) => (s['Due At'] instanceof Date ? s['Due At'] : due);
    const offices = rows.map((s) => `Part ${s.Part} &middot; ${escapeHtml_(s.Office)}` +
      (s.Status === SIG_STATUS.NOT_CLEARED ? ' <span style="color:#B3261E;">(marked Not Cleared — please update once settled)</span>'
        : rowDue(s) ? ` <span style="color:#555;">&mdash; act by <b>${formatLongDate_(rowDue(s))}</b>${isTrue_(s.Extended) ? ' (extended)' : ''}</span>` : '')).join('<br>');

    const intro = {
      REQUEST: '<p>The clearance below is now due for your action.</p>',
      REMINDER: '<p><b>Reminder:</b> the clearance below is still awaiting your action.</p>',
      FINAL: `<p><b>Final reminder:</b> the 30-day period after separation for settling accountabilities ends on
<b>${formatLongDate_(o.finalDeadline)}</b> (MC-2026-014 &sect;III.D.3). Accountabilities still unsettled after that date
are deducted from the employee's remaining pay. Please record your action on the items below.</p>`,
    }[kind];
    const note = kind === 'FINAL' ? ''
      : `<p style="font-size: 14px;">${deemed
        ? 'The row locks at <b>11:59 PM</b> of the date shown. If no action is recorded by then, the employee is <b>deemed cleared</b> by your office (MC-2026-014 &sect;III.E). If you are on official business, leave or travel, you may extend this to 7 working days in the portal before the deadline.'
        : 'Please act within three (3) working days (MC-2026-014 &sect;III.B.2).'}</p>`;

    const inner = `
<p>Dear <b>${escapeHtml_(rows[0]['Officer Name'])}</b>,</p>
${o.reopenReason ? `<div style="background:#fff8e1; border-left:5px solid ${ECL.BRAND.GOLD}; padding:12px; margin-bottom:12px;">
<b>Reopened by HRMDD.</b> Reason: ${escapeHtml_(o.reopenReason)}</div>` : ''}
${intro}
${detailsTable_(employeeRows_(req))}
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
  <tr style="background-color: #f2f2f2;"><td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 30%;">For your action</td>
    <td style="padding: 10px; border: 1px solid #ddd;">${offices}</td></tr>
</table>
${note}
${linkButton_(portalUrl_(req['Ref No']), 'Open in E-Clearance Portal')}
${portalNoteHtml_()}`;

    // The Supervisor follows progress in the single update thread instead of every request.
    const cc = rows.map((s) => s['Alternate Email']).concat(copyList_());
    const prefix = { REQUEST: 'Action needed', REMINDER: 'Reminder', FINAL: 'Final reminder' }[kind];
    sendMail_(email, subject_(`${prefix}: ${req['Employee Name (HRIS)']} (${req['Ref No']})`),
      { REQUEST: 'Clearance Request', REMINDER: 'Clearance Reminder', FINAL: 'Final Reminder' }[kind], inner, { cc });
  });
}

/** §III.E.3: HRMDD informs the clearing office that the employee is deemed cleared (cc clearance@). */
function notifyDeemedOfficer_(req, sig) {
  const inner = `
<p>Dear <b>${escapeHtml_(sig['Officer Name'])}</b>,</p>
<p>No action was recorded by your office on the clearance below within the prescribed period
(due ${formatLongDate_(sig['Due At'])}). Under MC-2026-014 &sect;III.E, the employee is <b>deemed cleared</b>
by <b>${escapeHtml_(sig.Office)}</b>.</p>
${detailsTable_(employeeRows_(req))}
<p style="font-size: 13px; color: #555;">This deemed clearance applies only to your office and is without prejudice to the
subsequent discovery of any outstanding accountability, including unreturned government property, unsettled financial
obligations, cash advances, records deficiencies or audit findings. It does not waive, condone or extinguish any valid
claim of DAP (MC-2026-014 &sect;III.E.4). Please coordinate with HRMDD if an accountability is later found.</p>`;
  const cc = [sig['Alternate Email']].concat(copyList_());
  sendMail_(sig['Officer Email'], subject_(`Deemed cleared: ${req['Employee Name (HRIS)']} — ${sig.Office} (${req['Ref No']})`),
    'Deemed Cleared', inner, { cc, replyTo: hrmddReplyTo_() });
}

function notifyDeemedEmployee_(req, sig) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p><b>${escapeHtml_(sig.Office)}</b> did not act on your clearance (${req['Ref No']}) within the prescribed period,
so you are <b>deemed cleared</b> by that office (MC-2026-014 &sect;III.E).</p>
<p style="font-size: 13px; color: #555;">A deemed clearance does not waive any accountability that may be found later (&sect;III.E.4).</p>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  sendUpdate_(req, `Deemed Cleared: ${sig.Office}`, inner);
}

/** Employee side of the 30-day reminder (update thread). */
function notifyFinalEmployee_(req, pending, deadline) {
  const list = pending.map((s) => `<li>Part ${s.Part} &middot; ${escapeHtml_(s.Office)} &mdash; ${s.Status === SIG_STATUS.NOT_CLEARED
    ? '<b style="color:#B3261E;">Not Cleared</b>' : 'awaiting action'}</li>`).join('');
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>The 30-day period after your separation for settling accountabilities ends on <b>${formatLongDate_(deadline)}</b>
(MC-2026-014 &sect;III.D.3). The following are still open on your clearance (${req['Ref No']}):</p>
<ul style="line-height: 1.6;">${list}</ul>
<p>Accountabilities still unsettled after that date will be deducted from your remaining pay. Please coordinate
with the offices concerned.</p>
${linkButton_(req['Live Form URL'], 'View My Live Clearance Form')}`;
  sendUpdate_(req, 'Final Reminder: 5 Days Left', inner);
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

/** Final electronic clearance, PDF attached, in the update thread. */
function notifyFinalized_(req, pdfBlob, verifyUrl) {
  const inner = `
<p>Dear <b>${escapeHtml_(req['Employee Name (HRIS)'])}</b>,</p>
<p>Your clearance (${req['Ref No']}) is <b>complete</b>. All signatories have cleared you of work-related, money and
property accountabilities, and the Acting Executive Vice President has issued the final certification.</p>
<p>Your electronic clearance (CS Form No. 7) is attached. It carries a QR code that anyone can scan to verify
it${verifyUrl ? '' : ' and open this PDF'}.</p>
${linkButton_(req['PDF URL'], 'Open Electronic Clearance (PDF)')}
${verifyUrl ? `<p style="text-align:center; font-size:13px;"><a href="${verifyUrl}" style="color:${ECL.BRAND.NAVY};">Verification page</a></p>` : ''}
<p style="font-size: 14px; color: #555;">Please submit the remaining separation requirements to HRMDD (Approved CS Form
No. 10, notarized SALN, notarized Security Reminder and the approved ALA form) for the processing of your terminal pay.</p>`;
  sendUpdate_(req, 'Clearance Complete', inner, pdfBlob ? [pdfBlob] : []);
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
