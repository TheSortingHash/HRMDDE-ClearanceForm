/**
 * Creating a clearance: reference no., live form copy, sharing, DB records, employee notice.
 */

/** Builds the 13 signatory rows for a request from the intake data and the Officers directory. */
function buildSignatories_(data, officers) {
  const byRow = {};
  officers.filter((o) => o.Active === true || String(o.Active).toUpperCase() === 'TRUE')
    .forEach((o) => (byRow[o['Row ID']] = o));

  const missing = [];
  const list = SIGNATORY_ROWS.map((row) => {
    if (row.rowId === 'II-SUP') return { ...row, name: data.supervisorName, email: data.supervisorEmail, alternate: '', alternateName: '' };
    if (row.rowId === 'II-HEAD') return { ...row, name: data.headName, email: data.headEmail, alternate: '', alternateName: '' };
    const o = byRow[row.rowId];
    if (!o || !o['Officer Name'] || !o['Officer Email']) {
      missing.push(row.rowId);
      return null;
    }
    return {
      ...row,
      office: o['Office / Unit'],
      name: String(o['Officer Name']).trim(),
      title: String(o['Officer Title'] || '').trim(),
      email: String(o['Officer Email']).trim().toLowerCase(),
      alternate: String(o['Alternate Email'] || '').trim().toLowerCase(),
      alternateName: String(o['Alternate Name'] || '').trim(),
    };
  });
  if (missing.length) {
    throw new Error(`The Officers directory has no active officer with an email for: ${missing.join(', ')}. ` +
      'Please complete the Officers sheet in the E-Clearance DB.');
  }
  return list;
}

function createClearance_(data, filedBy) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const open = readObjects_('Requests').find((r) =>
      String(r['Personal Email']).toLowerCase() === data.personalEmail && r.Status !== 'COMPLETED' && r.Status !== 'CANCELLED');
    if (open) throw new Error(`An open clearance already exists for ${data.personalEmail}: ${open['Ref No']}.`);

    const signatories = buildSignatories_(data, readObjects_('Officers'));
    const ref = nextRef_();
    const req = { ...data, ref };

    // 1. Live form copy.
    const file = DriveApp.getFileById(prop_('TEMPLATE_ID')).makeCopy(
      `${ref} — ${data.employeeName} — CS Form No. 7`, DriveApp.getFolderById(prop_('FOLDER_LIVE')));
    const ss = SpreadsheetApp.openById(file.getId());
    fillLiveForm_(ss, req, signatories);
    SpreadsheetApp.flush();

    // 2. View-only sharing, without Drive's own notification emails.
    const viewers = [data.personalEmail];
    signatories.forEach((s) => { viewers.push(s.email); if (s.alternate) viewers.push(s.alternate); });
    const warnings = shareViewOnly_(file.getId(), viewers);

    // 3. DB records. Everyone starts WAITING; advance_() below emails the first signatory.
    const now = new Date();
    appendObjects_('Requests', [{
      'Ref No': ref, Status: 'IN_PROGRESS', Stage: 'II', 'Filed At': now, 'Filed By': filedBy,
      'Employee Name (HRIS)': data.employeeName, 'Personal Email': data.personalEmail,
      'Position/SG/Step': data.position, 'Office of Assignment': data.office,
      'Date of Filing': data.dateOfFiling, 'Date of Effectivity': data.effectivity,
      Purpose: data.purpose, 'Other Purpose': data.otherPurpose,
      'Supervisor Name': data.supervisorName, 'Supervisor Email': data.supervisorEmail,
      'Head Name': data.headName, 'Head Email': data.headEmail,
      'Live Form ID': file.getId(), 'Live Form URL': ss.getUrl(),
    }]);
    appendObjects_('Signatories', signatories.map((s) => ({
      'Ref No': ref, 'Row ID': s.rowId, Part: s.part, Step: s.step, Office: s.office,
      'Officer Name': s.name, 'Officer Email': s.email,
      'Alternate Name': s.alternateName, 'Alternate Email': s.alternate,
      Status: SIG_STATUS.WAITING, Extended: false,
    })));
    audit_(ref, filedBy, 'FILED', { employee: data.employeeName, purpose: data.purpose, warnings });

    // 4. Employee notice (cc supervisor, + clearance@ outside test mode — MC-2026-014 §III.A.3).
    sendFiledNotice_(req, ss.getUrl());

    // 5. Route to the first signatory (Immediate Supervisor).
    advance_(ref);

    return { ref, employeeName: data.employeeName, url: ss.getUrl(), warnings };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Shares a file as Viewer with each address, suppressing Drive's notification email
 * (the system sends its own branded emails). Returns a list of warnings for failures.
 */
function shareViewOnly_(fileId, emails) {
  const warnings = [];
  const unique = Array.from(new Set(emails.map((e) => String(e).toLowerCase()).filter(Boolean)))
    .filter((e) => e !== ECL.HOST_EMAIL);
  unique.forEach((email) => {
    try {
      Drive.Permissions.create({ role: 'reader', type: 'user', emailAddress: email }, fileId,
        { sendNotificationEmail: false, supportsAllDrives: true });
    } catch (err) {
      warnings.push(`Could not share with ${email}: ${err.message}`);
    }
  });
  return warnings;
}

function copyList_() {
  return ECL.TEST_MODE ? [] : [ECL.CLEARANCE_GROUP];
}

function sendFiledNotice_(req, url) {
  const inner = `
<p>Dear <b>${escapeHtml_(req.employeeName)}</b>,</p>
<p>The HRMDD has filed your clearance (CS Form No. 7) for processing under MC-2026-014,
<i>Electronic Clearance Processing</i>.</p>
${detailsTable_([
  ['Reference No.', req.ref], ['Position/SG/Step', req.position], ['Office of Assignment', req.office],
  ['Purpose', req.purpose === 'Other Mode of Separation' ? `Other: ${req.otherPurpose}` : req.purpose],
  ['Date of Filing', formatLongDate_(req.dateOfFiling)], ['Date of Effectivity', formatLongDate_(req.effectivity)],
])}
<p><b>What happens next</b></p>
<ol style="padding-left: 20px; line-height: 1.6;">
  <li><b>Part II:</b> your Immediate Supervisor, then your Head of Office</li>
  <li><b>Part III:</b> all clearing offices, at the same time</li>
  <li><b>Part IV:</b> Certification of No Pending Administrative Case</li>
  <li><b>Part V:</b> Certification by the Acting Executive Vice President</li>
</ol>
<p>You will receive an email each time a signatory acts. You can also follow your clearance
in real time on your live form: the Part currently being processed is highlighted in gold, and
completed Parts in green.</p>
${linkButton_(url, 'View My Live Clearance Form')}
<p style="font-size: 14px; color: #555;">If a clearing office notes an accountability, you will be put in
direct contact with that office by email. Please settle accountabilities promptly; those unsettled
30 days after separation may be deducted from your remaining pay (MC-2026-014 &sect;III.D.3).</p>`;

  const cc = [req.supervisorEmail].concat(copyList_());
  GmailApp.sendEmail(req.personalEmail, `[E-Clearance${ECL.TEST_MODE ? ' TEST' : ''}] Clearance filed: ${req.ref}`, '', {
    htmlBody: brandedEmail_('Clearance Filed', inner),
    name: ECL.SENDER_NAME,
    cc: cc.join(','),
  });
}
