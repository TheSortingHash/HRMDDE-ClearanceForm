/**
 * Employee directory import (Employees sheet in the DB), used for intake autofill.
 *
 * Source: the E-Payment Hub "Payee_Database" tab (columns: Payee Name, Email Address, HRIS Number).
 * Set Settings → EMPLOYEE_SOURCE_ID to that spreadsheet's ID (comben@ needs view access), then run
 * importEmployees(). Re-run whenever the source list changes.
 *
 * Rules:
 *  - Active = has an @dap.edu.ph email. Rows marked "inactive employee" or with a non-DAP email
 *    are kept but inactive (not suggested on the intake form).
 *  - HRIS Number is stored as text ("211265", not 211265.0).
 *  - Position/Office typed by HRMDD in the Employees sheet are preserved across imports.
 */

/** Pure transform (no Google services) so it can be unit-tested. rows[0] = header row. */
function normalizeDirectory_(rows) {
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const col = (names) => names.map((n) => header.indexOf(n)).find((i) => i >= 0);
  const iName = col(['payee name', 'employee name (hris)', 'employee name', 'name']);
  const iEmail = col(['email address', 'dap email', 'email']);
  const iHris = col(['hris number', 'hris no', 'hris_number', 'hris no.']);
  if (iName === undefined) throw new Error('Source has no "Payee Name" column.');

  const stats = { total: 0, active: 0, inactiveMarked: 0, nonDapEmail: 0, noHris: 0 };
  const records = [];
  rows.slice(1).forEach((r) => {
    const name = String(r[iName] || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!name) return;
    stats.total++;
    const email = iEmail === undefined ? '' : String(r[iEmail] || '').trim().toLowerCase();
    let hris = iHris === undefined ? '' : String(r[iHris] == null ? '' : r[iHris]).trim().replace(/\.0+$/, '');
    if (!/^\d+$/.test(hris)) { hris = ''; stats.noHris++; }
    const dap = /^[^\s@]+@dap\.edu\.ph$/.test(email);
    if (dap) stats.active++;
    else if (/inactive/.test(email)) stats.inactiveMarked++;
    else if (email) stats.nonDapEmail++;
    records.push({ 'HRIS Number': hris, 'Employee Name (HRIS)': name, 'DAP Email': dap ? email : '', Active: dap });
  });

  // Same HRIS number under different names (usually a change of surname): report for HRMDD review.
  const byHris = {};
  records.filter((x) => x['HRIS Number']).forEach((x) => (byHris[x['HRIS Number']] = byHris[x['HRIS Number']] || []).push(x['Employee Name (HRIS)']));
  stats.sharedHris = Object.keys(byHris).filter((k) => byHris[k].length > 1).map((k) => `${k}: ${byHris[k].join(' / ')}`);

  records.sort((a, b) => a['Employee Name (HRIS)'].localeCompare(b['Employee Name (HRIS)']));
  return { records, stats };
}

function importEmployees() {
  const id = setting_('EMPLOYEE_SOURCE_ID');
  if (!id) throw new Error('Set Settings → EMPLOYEE_SOURCE_ID to the E-Payment Hub spreadsheet ID first.');
  const tab = setting_('EMPLOYEE_SOURCE_SHEET') || 'Payee_Database';
  const src = SpreadsheetApp.openById(id).getSheetByName(tab);
  if (!src) throw new Error(`Sheet "${tab}" not found in the source spreadsheet.`);

  const { records, stats } = normalizeDirectory_(src.getDataRange().getValues());

  // Keep HRMDD's manual Position/Office, and employees added by hand that are not in the source.
  const existing = readObjects_('Employees');
  const key = (x) => x['HRIS Number'] ? `H:${x['HRIS Number']}|${x['Employee Name (HRIS)']}` : `N:${x['Employee Name (HRIS)']}`;
  const old = {};
  existing.forEach((x) => (old[key({ ...x, 'HRIS Number': String(x['HRIS Number']).replace(/\.0+$/, '') })] = x));
  const seen = new Set();
  records.forEach((x) => {
    const o = old[key(x)];
    x.Position = o ? o.Position : '';
    x.Office = o ? o.Office : '';
    seen.add(key(x));
  });
  const manual = existing.filter((x) => !seen.has(key({ ...x, 'HRIS Number': String(x['HRIS Number']).replace(/\.0+$/, '') })));
  const all = records.concat(manual.map((x) => ({
    'HRIS Number': String(x['HRIS Number']).replace(/\.0+$/, ''), 'Employee Name (HRIS)': x['Employee Name (HRIS)'],
    'DAP Email': x['DAP Email'], Position: x.Position, Office: x.Office, Active: x.Active === true || String(x.Active).toUpperCase() === 'TRUE',
  })));

  const sh = table_('Employees');
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent().clearDataValidations();
  sh.getRange('A:A').setNumberFormat('@');
  const values = all.map((x) => headers.map((h) => (x[h] === undefined ? '' : x[h])));
  if (values.length) {
    sh.getRange(2, 1, values.length, headers.length).setValues(values);
    const activeCol = headers.indexOf('Active') + 1;
    if (activeCol) sh.getRange(2, activeCol, values.length, 1).insertCheckboxes()
      .setValues(all.map((x) => [x.Active === true]));
  }

  audit_('', currentUser_() || ECL.HOST_EMAIL, 'IMPORT_EMPLOYEES',
    { total: stats.total, active: stats.active, keptManual: manual.length, sharedHris: stats.sharedHris });
  console.log(`Imported ${stats.total} rows (${stats.active} active with DAP email, ${stats.inactiveMarked} marked inactive, ` +
    `${stats.nonDapEmail} with non-DAP email, ${stats.noHris} without HRIS No.); kept ${manual.length} manual entries.`);
  if (stats.sharedHris.length) console.log('Same HRIS No. under different names — please review: ' + stats.sharedHris.join('; '));
}
