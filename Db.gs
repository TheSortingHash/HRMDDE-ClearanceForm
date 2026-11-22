/**
 * Master database ("DAP E-Clearance DB" spreadsheet) — schema and helpers.
 * Each sheet is a table: row 1 = headers, one record per row.
 */
const DB_SCHEMA = {
  Settings: ['Key', 'Value', 'Notes'],
  Requests: ['Ref No', 'Status', 'Stage', 'Filed At', 'Filed By', 'HRIS Number', 'Employee Name (HRIS)', 'Personal Email',
    'Position/SG/Step', 'Office of Assignment', 'Date of Filing', 'Date of Effectivity', 'Purpose',
    'Other Purpose', 'Supervisor Name', 'Supervisor Email', 'Head Name', 'Head Email',
    'Live Form ID', 'Live Form URL', 'PDF URL', 'Completed At', 'Notes',
    'Update Thread ID', 'Update Message ID', 'Final Reminder At', 'PDF ID', 'Verify Code', 'Finalized At',
    'Revoked At', 'Revoke Reason', 'Documents Folder URL', 'Notice of Separation URL', 'CS Form 10 URL'],
  Signatories: ['Ref No', 'Row ID', 'Part', 'Step', 'Office', 'Officer Name', 'Officer Email',
    'Alternate Name', 'Alternate Email', 'Status', 'Sent At', 'Due At', 'Extended', 'Action',
    'Action At', 'Acted By', 'Details', 'Notation', 'Last Reminder At'],
  Officers: ['Row ID', 'Part', 'Group', 'Office / Unit', 'Officer Name', 'Officer Title', 'Officer Email',
    'Alternate Name', 'Alternate Email', 'Active'],
  // Employee directory for intake autofill (same layout as the E-Payment Hub Payee_Database).
  Employees: ['HRIS Number', 'Employee Name (HRIS)', 'DAP Email', 'Position', 'Office', 'Active'],
  Holidays: ['Date', 'Name', 'Type'],
  AuditLog: ['Timestamp', 'Ref No', 'Actor', 'Event', 'Details'],
};

/** Signatory statuses. WAITING = an earlier step is not done yet; SENT = emailed, awaiting action. */
const SIG_STATUS = {
  WAITING: 'WAITING', QUEUED: 'QUEUED', SENT: 'SENT', CLEARED: 'CLEARED',
  NOT_CLEARED: 'NOT_CLEARED', DEEMED_CLEARED: 'DEEMED_CLEARED', HOLD: 'HOLD',
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function db_() {
  const id = prop_('DB_ID');
  if (!id) throw new Error('System not set up yet. Run setupSystem() first.');
  return SpreadsheetApp.openById(id);
}

function table_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error(`DB sheet "${name}" is missing.`);
  return sh;
}

/** Reads a table into objects keyed by header. Each object also gets _row (sheet row number). */
function readObjects_(name) {
  const sh = table_(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  return values.map((r, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => (o[h] = r[j]));
    return o;
  }).filter((o) => headers.some((h) => o[h] !== '' && o[h] !== null));
}

/** Appends objects to a table, matching keys to headers. */
function appendObjects_(name, objects) {
  if (!objects.length) return;
  const sh = table_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const rows = objects.map((o) => headers.map((h) => (o[h] === undefined ? '' : o[h])));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

/** Writes selected fields of one record (row number from readObjects_ `_row`). */
function updateRow_(name, rowNum, changes) {
  const sh = table_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  Object.keys(changes).forEach((k) => {
    const col = headers.indexOf(k);
    if (col < 0) throw new Error(`Column "${k}" not found in ${name}.`);
    sh.getRange(rowNum, col + 1).setValue(changes[k] === undefined ? '' : changes[k]);
  });
}

/** Settings sheet lookup. */
function setting_(key) {
  const row = readObjects_('Settings').find((r) => r.Key === key);
  return row ? String(row.Value) : '';
}

function settingList_(key) {
  return setting_(key).split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(String);
}

function audit_(ref, actor, event, details) {
  appendObjects_('AuditLog', [{
    Timestamp: new Date(), 'Ref No': ref || '', Actor: actor || '', Event: event,
    Details: typeof details === 'string' ? details : JSON.stringify(details || ''),
  }]);
}

/** Next reference number, e.g. ECL-2026-0001 (sequence resets each year). */
function nextRef_() {
  const year = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy');
  const key = 'SEQ_' + year;
  const n = Number(prop_(key) || 0) + 1;
  setProp_(key, String(n));
  return `ECL-${year}-${('000' + n).slice(-4)}`;
}
