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
      'HRIS Number': data.hrisNumber,
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

    // 4. Employee notice: first message of the clearance's update thread (cc supervisor).
    sendFiledNotice_(getRequest_(ref));

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
