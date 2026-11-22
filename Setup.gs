/**
 * One-time setup. Run setupSystem() from the Apps Script editor as comben@dap.edu.ph.
 * Safe to re-run: existing folders, DB and template are reused, missing pieces are created.
 */
function setupSystem() {
  const root = getOrCreateFolder_(DriveApp.getRootFolder(), FOLDERS.ROOT);
  ['TEMPLATE', 'LIVE', 'COMPLETED'].forEach((k) => {
    const f = getOrCreateFolder_(root, FOLDERS[k]);
    setProp_('FOLDER_' + k, f.getId());
  });
  setProp_('FOLDER_ROOT', root.getId());

  setupDb_(root);
  if (!prop_('TEMPLATE_ID')) buildTemplate_();
  installTriggers();

  console.log('Root folder:  ' + root.getUrl());
  console.log('Database:     ' + db_().getUrl());
  console.log('Template:     ' + SpreadsheetApp.openById(prop_('TEMPLATE_ID')).getUrl());
}

/** Rebuilds the cleaned-up template from the original CS Form No. 7 (old template is trashed). */
function rebuildTemplate() {
  const old = prop_('TEMPLATE_ID');
  if (old) DriveApp.getFileById(old).setTrashed(true);
  PropertiesService.getScriptProperties().deleteProperty('TEMPLATE_ID');
  buildTemplate_();
  console.log('Template:     ' + SpreadsheetApp.openById(prop_('TEMPLATE_ID')).getUrl());
}

function setupDb_(root) {
  let ss;
  if (prop_('DB_ID')) {
    ss = SpreadsheetApp.openById(prop_('DB_ID'));
  } else {
    ss = SpreadsheetApp.create('DAP E-Clearance DB');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    setProp_('DB_ID', ss.getId());
  }

  Object.keys(DB_SCHEMA).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      const headers = DB_SCHEMA[name];
      sh.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground(ECL.BRAND.NAVY).setFontColor('#ffffff');
      sh.setFrozenRows(1);
      seedTable_(name, sh);
    } else {
      ensureHeaders_(sh, DB_SCHEMA[name]);
    }
  });
  ensureSettings_(ss.getSheetByName('Settings'));
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
}

/** Adds columns introduced by later phases to an existing table (appended at the end). */
function ensureHeaders_(sh, headers) {
  const have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  headers.filter((h) => have.indexOf(h) < 0).forEach((h) => {
    const col = sh.getLastColumn() + 1;
    sh.getRange(1, col).setValue(h).setFontWeight('bold')
      .setBackground(ECL.BRAND.NAVY).setFontColor('#ffffff');
  });
}

/** Adds Settings keys introduced by later phases without touching existing values. */
function ensureSettings_(sh) {
  const keys = sh.getDataRange().getValues().map((r) => r[0]);
  SEED_DATA_.Settings.filter((r) => keys.indexOf(r[0]) < 0).forEach((r) => sh.appendRow(r));
}

function seedTable_(name, sh) {
  const rows = name === 'Settings' ? [] : SEED_DATA_[name];
  if (name === 'Settings') ensureSettings_(sh);
  if (name === 'Employees') sh.getRange('A:A').setNumberFormat('@'); // keep HRIS numbers as text
  if (rows && rows.length) sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  if (name === 'Holidays') sh.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  if (name === 'Employees') {
    sh.getRange(2, 6, rows.length, 1).insertCheckboxes();
    sh.getRange(2, 6, rows.length, 1).setValue(true);
  }
  if (name === 'Officers') {
    sh.getRange(2, 10, Math.max(rows.length, 1), 1).insertCheckboxes();
    sh.getRange(2, 10, rows.length, 1).setValue(true);
  }
  sh.autoResizeColumns(1, sh.getLastColumn());
}

/**
 * Seed data. Officer emails are the prototype TEST addresses (Dean and Mariel only) — replace
 * them with the real official addresses in the Officers sheet before go-live.
 */
const SEED_DATA_ = {
  // Starter entries; run importEmployees() to load the full directory from the E-Payment Hub.
  Employees: [
    ['211265', 'ANCHETA, DEAN JOSEPH HANS M.', 'anchetad@dap.edu.ph', '', '', true],
    ['213147', 'ANCHETA, MARIEL LOUISE P', 'anchetam@dap.edu.ph', '', '', true],
  ],
  Settings: [
    ['RSP_USERS', 'comben@dap.edu.ph, anchetad@dap.edu.ph', 'DAP accounts allowed to use the intake web app (comma-separated).'],
    ['HRMDD_ADMINS', 'comben@dap.edu.ph', 'DAP accounts that see the All-Clearances dashboard and can reopen rows.'],
    ['WEBAPP_URL', '', 'The web app /exec URL used in email links. Leave blank to detect it automatically.'],
    ['EMPLOYEE_SOURCE_ID', '', 'Spreadsheet ID of the E-Payment Hub (source of the employee directory for importEmployees).'],
    ['EMPLOYEE_SOURCE_SHEET', 'Payee_Database', 'Tab in the source spreadsheet with Payee Name, Email Address, HRIS Number.'],
  ],
  Officers: [
    ['III-1a', 'III', '1. Administrative Services', 'Supply and Property Procurement and Management Services (Logistics Division)', 'JOMAR A. PASTRANA', '', 'anchetam@dap.edu.ph', '', '', true],
    ['III-1b', 'III', '1. Administrative Services', 'Human Resource Welfare and Assistance (Human Resource Management Division)', 'REYNALYN T. PADSOYAN', '', 'anchetad@dap.edu.ph', '', '', true],
    ['III-1c', 'III', '1. Administrative Services', 'Agency-accredited Union/Cooperative (DPMPC)', 'CHRISTIAN S. EPARWA', '', 'anchetad@dap.edu.ph', '', '', true],
    ['III-2a', 'III', '2. Library', 'Library', 'MA. THERESA O. JAVIER', '', 'anchetam@dap.edu.ph', '', '', true],
    ['III-2b', 'III', '2. Library', 'Central Documentation & Records Division (CDRD)', 'LIZA ROSE I. FETALINO', '', 'anchetad@dap.edu.ph', '', '', true],
    ['III-3a', 'III', '3. Finance and Assets Management', 'Financial Services', 'ANATALIA SD. BARAWIDAN', '', 'anchetam@dap.edu.ph', '', '', true],
    ['III-3b', 'III', '3. Finance and Assets Management', 'Transaction, Processing, & Billing Services', 'ANATALIA SD. BARAWIDAN', '', 'anchetam@dap.edu.ph', '', '', true],
    ['III-3c', 'III', '3. Finance and Assets Management', 'Payroll & Remittance Services (HRMD - Compensation and Benefits Unit)', 'REYNALYN T. PADSOYAN', '', 'anchetad@dap.edu.ph', '', '', true],
    ['III-4a', 'III', '4. Professional and Institutional Development', 'Scholarship Services / Performance Commitment Review Form (HR Development Division)', 'REYNALYN T. PADSOYAN', '', 'anchetad@dap.edu.ph', '', '', true],
    ['IV-a', 'IV', 'Certification of No Pending Administrative Case', 'Internal Affairs Office/Legal Service Office', 'ATTY. LESTER JOHN A. VILLAR', '', 'anchetad@dap.edu.ph', '', '', true],
    ['V-EVP', 'V', 'Certification', 'Office of the Executive Vice President', 'MAGDALENA L. MENDOZA', 'Acting Executive Vice President', 'anchetam@dap.edu.ph', '', '', true],
  ],
};

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
