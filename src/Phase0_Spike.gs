/**
 * PHASE 0 — Gmail button spike.
 *
 * Purpose: prove that clearing officers can act entirely from Gmail.
 *   1. spikeSendTestEmails()   -> sends branded emails with per-row buttons to the test addresses
 *   2. officer clicks a button -> Gmail opens a pre-filled compose -> officer presses Send
 *   3. spikeProcessInbox()     -> (every minute) validates the email, records it, replies with a receipt
 *
 * Everything is logged to the "E-Clearance Phase 0 Log" spreadsheet in the host's Drive,
 * including the Authentication-Results header so we learn how internal DAP mail is stamped.
 *
 * Run order: spikeSendTestEmails -> spikeInstallTrigger -> click buttons -> check the log
 *            -> spikeRemoveTriggers when done. spikeReset clears state for another round.
 */

const SPIKE = {
  REF: 'ECL-TEST-0001',
  EMPLOYEE: {
    hrisName: 'DELA CRUZ, JUAN P.',
    personalEmail: 'anchetad@dap.edu.ph', // stand-in for the employee's personal Gmail
    position: 'Administrative Officer IV, SG-15/Step 1',
    office: 'Human Resource Management and Development Department',
    purpose: 'Resignation',
    dateOfFiling: '2026-11-23',
    effectivity: '2026-12-31',
  },
  SUPERVISOR_EMAIL: 'anchetam@dap.edu.ph',
  // Test assignments exercise every button set plus the multi-row ("duplicate officer") case.
  ROWS: [
    { rowId: 'II-SUP', part: 'II', office: 'Immediate Supervisor', officer: 'anchetam@dap.edu.ph' },
    { rowId: 'III-1b', part: 'III', office: 'Human Resource Welfare and Assistance (HRMD)', officer: 'anchetad@dap.edu.ph' },
    { rowId: 'III-3c', part: 'III', office: 'Payroll & Remittance Services (HRMD - Compensation and Benefits Unit)', officer: 'anchetad@dap.edu.ph' },
    { rowId: 'III-4a', part: 'III', office: 'Scholarship Services / Performance Commitment Review Form (HRDD)', officer: 'anchetad@dap.edu.ph' },
    { rowId: 'III-3a', part: 'III', office: 'Financial Services', officer: 'fd-omd-gse@dap.edu.ph' },
    { rowId: 'IV-a', part: 'IV', office: 'Internal Affairs Office / Legal Service Office', officer: 'fd-omd-gse@dap.edu.ph' },
    { rowId: 'V-EVP', part: 'V', office: 'Certification — Acting Executive Vice President', officer: 'anchetam@dap.edu.ph' },
  ],
};

const LOG_HEADERS_ = ['Processed At', 'Email Sent At', 'Sender', 'Ref', 'Row', 'Action', 'Parsed From',
  'Code OK', 'Auth-Results', 'Outcome', 'Details', 'Message ID', 'Subject', 'Body (if subject fallback)'];

/* ---------------------------------------------------------------- send */

function spikeSendTestEmails() {
  const byOfficer = {};
  SPIKE.ROWS.forEach((r) => (byOfficer[r.officer] = byOfficer[r.officer] || []).push(r));

  Object.keys(byOfficer).forEach((officer) => {
    const rows = byOfficer[officer];
    const E = SPIKE.EMPLOYEE;
    const inner = `
<p>Dear Clearing Officer,</p>
<p>The employee below has filed for clearance. Please act on each row assigned to you
within <b>three (3) working days</b> (MC-2026-014 §III.B.2).</p>
${detailsTable_([
  ['Reference No.', SPIKE.REF], ['Employee', E.hrisName], ['Position/SG/Step', E.position],
  ['Office of Assignment', E.office], ['Purpose', E.purpose], ['Date of Effectivity', E.effectivity],
])}
${officerInstructionsHtml_()}
${rows.map((r) => rowCard_(SPIKE.REF, r, officer)).join('')}
<p style="font-size: 13px; color: #555;">You will receive a confirmation reply for every action recorded.</p>`;

    GmailApp.sendEmail(officer, `[E-Clearance TEST] Action needed: ${E.hrisName} (${SPIKE.REF})`, '', {
      htmlBody: brandedEmail_('Clearance Request', inner,
        'TEST MESSAGE — Phase 0 of the DAP E-Clearance System prototype.'),
      name: ECL.SENDER_NAME,
    });
  });
  getLogSheet_(); // create the log up front so its URL appears in the execution log
}

/* ---------------------------------------------------------------- process */

function spikeProcessInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const sheet = getLogSheet_();
    const seen = new Set(sheet.getLastRow() > 1
      ? sheet.getRange(2, 12, sheet.getLastRow() - 1, 1).getValues().map((r) => r[0]) : []);
    const processedLabel = getOrCreateLabel_(ECL.LABEL_PROCESSED);
    const rejectedLabel = getOrCreateLabel_(ECL.LABEL_REJECTED);

    const threads = GmailApp.search(`to:${ECL.ACTION_ADDRESS} newer_than:14d`, 0, 50);
    threads.forEach((thread) => {
      let rejected = false;
      thread.getMessages().forEach((msg) => {
        const id = msg.getId();
        if (seen.has(id)) return;
        const sender = extractEmail_(msg.getFrom());
        if (sender === ECL.HOST_EMAIL) return; // our own receipts
        if (String(msg.getTo()).toLowerCase().indexOf(ECL.ACTION_ADDRESS) < 0) return;

        const result = handleCommandMessage_(msg, sender);
        sheet.appendRow([new Date(), msg.getDate(), sender, result.cmd ? result.cmd.ref : '',
          result.cmd ? result.cmd.rowId : '', result.cmd ? result.cmd.action : '',
          result.cmd ? result.cmd.source : '', result.codeOk, result.auth, result.outcome,
          result.cmd ? result.cmd.details : '', id, msg.getSubject(),
          result.cmd && result.cmd.source === 'subject' ? msg.getPlainBody().slice(0, 500) : '']);
        seen.add(id);
        if (!result.ok) rejected = true;
      });
      thread.addLabel(rejected ? rejectedLabel : processedLabel);
      thread.markRead();
    });
  } finally {
    lock.releaseLock();
  }
}

/** Validates one command email, updates spike state, and sends the receipt. */
function handleCommandMessage_(msg, sender) {
  const res = { ok: false, cmd: null, codeOk: '', auth: '', outcome: '' };
  res.auth = (msg.getHeader('Authentication-Results') || '(none)').slice(0, 300);
  const cmd = parseCommand_(msg.getSubject(), msg.getPlainBody());
  res.cmd = cmd;

  const reject = (why) => {
    res.outcome = 'REJECTED: ' + why;
    replyReceipt_(msg, false, cmd, why);
    return res;
  };

  if (!cmd) return reject('The clearance code could not be read. Please use the buttons in the original request email without editing the code block.');
  if (cmd.ref !== SPIKE.REF) return reject(`Unknown reference number ${cmd.ref}.`);

  const row = SPIKE.ROWS.find((r) => r.rowId === cmd.rowId);
  if (!row) return reject(`Unknown row ${cmd.rowId}.`);
  if (sender !== row.officer.toLowerCase()) return reject(`Row ${row.rowId} is assigned to a different clearing officer.`);

  // DAP mail is DKIM-signed by gappssmtp.com (Google default), so rely on SPF/DMARC for
  // dap.edu.ph. DAP's DMARC policy is p=NONE, so require a positive pass, not just "no fail".
  const authOk = /dmarc=pass/i.test(res.auth) ||
    /spf=pass[^;]*smtp\.mailfrom=[^;\s]*@dap\.edu\.ph/i.test(res.auth);
  if (!authOk || /(spf|dmarc)=fail/i.test(res.auth)) return reject('The email failed DAP sender authentication.');

  res.codeOk = verifyCode_(cmd.ref, cmd.rowId, sender, cmd.code);
  if (!res.codeOk) return reject('The verification code does not match.');

  const def = ACTIONS[cmd.action];
  if (!def || BUTTON_SETS[row.part].indexOf(cmd.action) < 0) return reject(`Action ${cmd.action} is not allowed for Part ${row.part}.`);
  if (def.needsDetails && cmd.details.length < ECL.MIN_DETAILS_LENGTH) {
    return reject(`Specific details are required for this action (at least ${ECL.MIN_DETAILS_LENGTH} characters). Please click the button again and state the item and the action the employee must take, at the top of the email, before sending.`);
  }

  const state = getSpikeState_();
  const current = state[row.rowId] || {};
  if (current.action && ACTIONS[current.action].final) {
    return reject(`This row was already recorded as ${ACTIONS[current.action].label} on ${current.at}. Only HRMDD can reopen it.`);
  }
  if (cmd.action === 'EXTEND_OB' && current.extended) return reject('The 7-working-day extension was already applied to this row.');

  const at = Utilities.formatDate(msg.getDate(), 'Asia/Manila', 'd MMM yyyy, h:mm a');
  if (cmd.action === 'EXTEND_OB') {
    current.extended = true;
  } else {
    current.action = cmd.action;
    current.at = at;
    current.details = cmd.details;
  }
  state[row.rowId] = current;
  setSpikeState_(state);

  res.ok = true;
  res.outcome = 'RECORDED';
  replyReceipt_(msg, true, cmd, `${def.label} — Row ${row.rowId} (${row.office}), ${at} PHT.`);
  if (def.needsDetails) sendAccountabilityThread_(row, cmd, sender);
  return res;
}

/** Receipt in the same Gmail thread as the officer's email. */
function replyReceipt_(msg, ok, cmd, text) {
  const inner = `<p>${ok ? '&#9989; <b>Recorded:</b> ' : '&#9888;&#65039; <b>Not recorded.</b> '}${escapeHtml_(text)}</p>
    ${cmd ? detailsTable_([['Reference No.', cmd.ref], ['Row', cmd.rowId], ['Action', cmd.action]]) : ''}`;
  msg.reply('', {
    htmlBody: brandedEmail_(ok ? 'Action Recorded' : 'Action Not Recorded', inner),
    name: ECL.SENDER_NAME,
  });
}

/**
 * Not Cleared / pending case / Hold: open a direct thread between the employee and the
 * officer (Reply-To = officer), cc supervisor (+ clearance@ outside TEST_MODE).
 */
function sendAccountabilityThread_(row, cmd, officerEmail) {
  const E = SPIKE.EMPLOYEE;
  const def = ACTIONS[cmd.action];
  const inner = `
<p>Dear <b>${escapeHtml_(E.hrisName)}</b>,</p>
<p>Your clearance (${SPIKE.REF}) was marked <b>${def.label}</b> by
<b>${escapeHtml_(row.office)}</b>. The details are below.</p>
<div style="background:#fdecea; border-left:5px solid #B3261E; padding:12px; white-space:pre-wrap;">${escapeHtml_(cmd.details)}</div>
<p>Please coordinate directly with the clearing officer by <b>replying to this email</b>
(MC-2026-014 §III.D.1). Once settled, the officer will record the clearance using the
original request email.</p>`;
  const cc = [officerEmail, SPIKE.SUPERVISOR_EMAIL];
  if (!ECL.TEST_MODE) cc.push(ECL.CLEARANCE_GROUP);
  GmailApp.sendEmail(E.personalEmail, `[E-Clearance${ECL.TEST_MODE ? ' TEST' : ''}] ${def.label}: ${row.office} (${SPIKE.REF})`, '', {
    htmlBody: brandedEmail_(def.label, inner),
    name: ECL.SENDER_NAME,
    replyTo: officerEmail,
    cc: cc.join(','),
  });
}

/* ---------------------------------------------------------------- triggers & state */

function spikeInstallTrigger() {
  spikeRemoveTriggers();
  ScriptApp.newTrigger('spikeProcessInbox').timeBased().everyMinutes(1).create();
}

function spikeRemoveTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'spikeProcessInbox')
    .forEach((t) => ScriptApp.deleteTrigger(t));
}

/** Clears recorded row states so the test can be repeated. The log is kept. */
function spikeReset() {
  PropertiesService.getScriptProperties().deleteProperty('SPIKE_STATE');
}

function getSpikeState_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('SPIKE_STATE') || '{}');
}

function setSpikeState_(state) {
  PropertiesService.getScriptProperties().setProperty('SPIKE_STATE', JSON.stringify(state));
}

function getLogSheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPIKE_LOG_ID');
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('E-Clearance Phase 0 Log');
    props.setProperty('SPIKE_LOG_ID', ss.getId());
    const sh = ss.getSheets()[0];
    sh.setName('Log');
    sh.appendRow(LOG_HEADERS_);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, LOG_HEADERS_.length).setFontWeight('bold')
      .setBackground(ECL.BRAND.NAVY).setFontColor('#ffffff');
  }
  const log = ss.getSheetByName('Log');
  // Logs created by an earlier version lack the newest column header.
  log.getRange(1, 1, 1, LOG_HEADERS_.length).setValues([LOG_HEADERS_]);
  console.log('Phase 0 log: ' + ss.getUrl());
  return log;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
