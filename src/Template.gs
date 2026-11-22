/**
 * CS Form No. 7 template: one-time cleanup + named ranges, and helpers to fill a live copy.
 *
 * Layout is preserved: labels stay where they are and values are written after the label in the
 * same cell (underlined). Every field/signature cell gets a named range, so code finds cells by
 * name and keeps working if HRMDD later moves rows in the template.
 */

const BOX_EMPTY = '☐';
const BOX_TICKED = '☑';

/** Named ranges for intake fields. */
const FIELD_RANGES = {
  ECL_REF: 'M2:O2',
  ECL_DATE_FILING: 'L8:N8',
  ECL_PURPOSE_TRANSFER: 'E12',
  ECL_PURPOSE_RETIREMENT: 'E13',
  ECL_PURPOSE_RESIGNATION: 'H12',
  ECL_PURPOSE_LEAVE: 'H13',
  ECL_PURPOSE_OTHER: 'J12',
  ECL_PURPOSE_OTHER_TEXT: 'K13',
  ECL_EFFECTIVITY: 'D14',
  ECL_OFFICE: 'A16',
  ECL_POSITION: 'A18',
  ECL_EMPLOYEE_NAME: 'J17:O17',
  ECL_II_STATEMENT: 'A21:O21',
  ECL_IV_PENDING_CASE: 'E41',
  ECL_IV_INVESTIGATION: 'E42',
  ECL_HDR_II: 'A20:O20',
  ECL_HDR_III: 'A24:O24',
  ECL_HDR_IV: 'A39:O39',
  ECL_HDR_V: 'A44:O44',
};

/** Labels kept in front of the value in label+value cells. */
const FIELD_LABELS = {
  ECL_REF: 'Ref. No.: ',
  ECL_PURPOSE_OTHER_TEXT: '  Please specify: ',
  ECL_EFFECTIVITY: 'Date of Effectivity: ',
  ECL_OFFICE: 'Office of Assignment: ',
  ECL_POSITION: '       Position/SG/Step: ',
};

/** "III-1a" -> "III_1A" (named ranges allow letters, digits, underscores only). */
function sigKey_(rowId) {
  return rowId.replace('-', '_').toUpperCase();
}

/** A1 cells for one signatory row: name, cleared, notCleared, sign. */
function signatoryCells_(row) {
  if (row.sheetRow) {
    const r = row.sheetRow;
    return { name: `L${r}:M${r}`, cleared: `I${r}`, notCleared: `J${r}:K${r}`, sign: `N${r}:O${r}` };
  }
  return { name: row.cells.name, sign: row.cells.sign || row.cells.name };
}

function buildTemplate_() {
  const folder = DriveApp.getFolderById(prop_('FOLDER_TEMPLATE'));
  const file = DriveApp.getFileById(TEMPLATE_SOURCE_ID).makeCopy('CS Form No. 7 — E-Clearance Template', folder);
  const ss = SpreadsheetApp.openById(file.getId());
  cleanupTemplate_(ss);
  setProp_('TEMPLATE_ID', ss.getId());
}

function cleanupTemplate_(ss) {
  const sh = ss.getSheetByName(FORM_SHEET);

  // Purpose: the Wingdings "£" check boxes render as pound signs in Sheets.
  sh.getRange('E12').setValue(`${BOX_EMPTY} Transfer`);
  sh.getRange('E13').setValue(`${BOX_EMPTY} Retirement`);
  sh.getRange('H12').setValue(`${BOX_EMPTY} Resignation`);
  sh.getRange('H13').setValue(`${BOX_EMPTY} Leave`);
  sh.getRange('J12').setValue(`${BOX_EMPTY} Other Mode of Separation:`);

  // Label-only cells (values are appended at fill time).
  Object.keys(FIELD_LABELS).forEach((k) => {
    if (k !== 'ECL_REF') sh.getRange(FIELD_RANGES[k]).setValue(FIELD_LABELS[k]);
  });

  // Reference number slot, top right.
  sh.getRange('M2:O2').merge().setHorizontalAlignment('right').setFontSize(9).setFontFamily('Arial')
    .setValue(FIELD_LABELS.ECL_REF);

  // Employee name line (underscores -> bottom border).
  sh.getRange('J17:O17').setValue('').setHorizontalAlignment('center').setFontWeight('bold')
    .setFontFamily('Arial').setBorder(null, null, true, null, null, null);

  // Part II statement with real check boxes; signature lines become bordered name cells.
  sh.getRange('A21').setValue(
    `We hereby certify that this employee is ${BOX_EMPTY} cleared   ${BOX_EMPTY} not cleared   ` +
    'of work-related accountabilities from this Unit/Office/Dept.');
  sh.getRange('D22:H22').merge();
  [sh.getRange('D22:H22'), sh.getRange('J22:N22')].forEach((r) => r.setValue('')
    .setHorizontalAlignment('center').setVerticalAlignment('bottom').setFontWeight('bold')
    .setFontFamily('Arial').setBorder(null, null, true, null, null, null));

  // Part IV options.
  sh.getRange('E41').setValue(`${BOX_EMPTY} with pending administrative case`);
  sh.getRange('E42').setValue(`${BOX_EMPTY} with ongoing investigation (no formal charge yet)`);

  // Row 28's signature cell is the only one not merged in the original.
  sh.getRange('N28:O28').merge();

  // Part V notation line above the EVP name.
  sh.getRange('A49:O49').merge().setHorizontalAlignment('center').setFontSize(8);

  // Named ranges.
  Object.keys(FIELD_RANGES).forEach((name) => ss.setNamedRange(name, sh.getRange(FIELD_RANGES[name])));
  SIGNATORY_ROWS.forEach((row) => {
    const cells = signatoryCells_(row);
    Object.keys(cells).forEach((kind) => {
      ss.setNamedRange(`ECL_SIG_${sigKey_(row.rowId)}_${kind.toUpperCase()}`, sh.getRange(cells[kind]));
    });
  });
  SpreadsheetApp.flush();
}

/* ------------------------------------------------------------------ fill helpers */

/** Top-left cell of a named range (writing to a whole merged range would fill every cell). */
function named_(ss, name) {
  const r = ss.getRangeByName(name);
  if (!r) throw new Error(`Template is missing named range ${name}. Run rebuildTemplate().`);
  return r.getCell(1, 1);
}

/** Writes "Label: VALUE" with the value bold + underlined, keeping the label's look. */
function setLabeled_(range, label, value) {
  const text = label + (value || '');
  const b = SpreadsheetApp.newRichTextValue().setText(text);
  if (value) {
    b.setTextStyle(label.length, text.length,
      SpreadsheetApp.newTextStyle().setBold(true).setUnderline(true).build());
  }
  range.setRichTextValue(b.build());
}

/** Ticks or clears the first box in a "☐ Label" cell. */
function setBox_(range, ticked) {
  range.setValue(String(range.getDisplayValue())
    .replace(/[☐☑]/, ticked ? BOX_TICKED : BOX_EMPTY));
}

function formatLongDate_(d) {
  return d ? Utilities.formatDate(d, 'Asia/Manila', 'MMMM d, yyyy') : '';
}

/** Fills a fresh copy of the template with the request and signatory names. */
function fillLiveForm_(ss, req, signatories) {
  setLabeled_(named_(ss, 'ECL_REF'), FIELD_LABELS.ECL_REF, req.ref);
  named_(ss, 'ECL_DATE_FILING').setValue(formatLongDate_(req.dateOfFiling))
    .setHorizontalAlignment('center').setFontWeight('bold');
  named_(ss, 'ECL_EMPLOYEE_NAME').setValue(req.employeeName);
  setLabeled_(named_(ss, 'ECL_EFFECTIVITY'), FIELD_LABELS.ECL_EFFECTIVITY, formatLongDate_(req.effectivity));
  setLabeled_(named_(ss, 'ECL_OFFICE'), FIELD_LABELS.ECL_OFFICE, req.office);
  setLabeled_(named_(ss, 'ECL_POSITION'), FIELD_LABELS.ECL_POSITION, req.position);

  const purposeRange = {
    Transfer: 'ECL_PURPOSE_TRANSFER', Retirement: 'ECL_PURPOSE_RETIREMENT',
    Resignation: 'ECL_PURPOSE_RESIGNATION', Leave: 'ECL_PURPOSE_LEAVE',
    'Other Mode of Separation': 'ECL_PURPOSE_OTHER',
  };
  Object.keys(purposeRange).forEach((p) => setBox_(named_(ss, purposeRange[p]), p === req.purpose));
  setLabeled_(named_(ss, 'ECL_PURPOSE_OTHER_TEXT'), FIELD_LABELS.ECL_PURPOSE_OTHER_TEXT,
    req.purpose === 'Other Mode of Separation' ? req.otherPurpose : '');

  signatories.forEach((s) => {
    const cell = named_(ss, `ECL_SIG_${sigKey_(s.rowId)}_NAME`);
    cell.setValue(s.title ? `${s.name}\n${s.title}` : s.name);
  });

  highlightStage_(ss, 'II');
}

/** Colours Part headers: done = green, current = gold. stage 'COMPLETED' = all green. */
function highlightStage_(ss, stage) {
  const idx = stage === 'COMPLETED' ? PART_ORDER.length : PART_ORDER.indexOf(stage);
  PART_ORDER.forEach((p, i) => {
    let bg = null;
    if (i < idx) bg = STAGE_COLORS.DONE;
    else if (i === idx) bg = STAGE_COLORS.CURRENT;
    ss.getRangeByName('ECL_HDR_' + p).setBackground(bg);
  });
}
