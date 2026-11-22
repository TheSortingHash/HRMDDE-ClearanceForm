/**
 * DAP E-Clearance System — global configuration.
 * Runs entirely inside Google Workspace under the host account.
 */
const ECL = {
  HOST_EMAIL: 'comben@dap.edu.ph',
  // Plus-address that receives the officers' button emails. Gmail delivers it to the host inbox.
  ACTION_ADDRESS: 'comben+eclearance@dap.edu.ph',
  SENDER_NAME: 'DAP E-Clearance System',
  // MC-2026-014 §III.A.3: copy-furnish on all correspondence. Suppressed while TEST_MODE is true.
  CLEARANCE_GROUP: 'clearance@dap.edu.ph',
  TEST_MODE: true,

  BRAND: {
    NAVY: '#1C2790',
    GOLD: '#CDAE2C',
    LOGO: 'https://i.imgur.com/jaEbfAR.png',
  },

  LABEL_PROCESSED: 'E-Clearance/Processed',
  LABEL_REJECTED: 'E-Clearance/Rejected',

  // Minimum characters required when an action needs a written explanation.
  MIN_DETAILS_LENGTH: 25,
};

/**
 * Every action a signatory can take from an email button.
 * `final: true` = once recorded, only an HRMDD admin action can reopen the row.
 */
const ACTIONS = {
  CLEARED: {
    label: 'Cleared', button: 'CLEARED', color: '#1E7B34', final: true,
  },
  NOT_CLEARED: {
    label: 'Not Cleared', button: 'NOT CLEARED', color: '#B3261E', needsDetails: true,
    prompt: 'Accountability and action needed to settle it:',
  },
  EXTEND_OB: {
    label: 'On Official Business / Leave (extended to 7 working days)', button: 'ON OB / LEAVE', color: '#5F6368',
  },
  NO_PENDING_CASE: {
    label: 'No pending administrative case', button: 'NO PENDING CASE', color: '#1E7B34', final: true,
  },
  PENDING_ADMIN_CASE: {
    label: 'With pending administrative case', button: 'WITH PENDING ADMIN CASE', color: '#B3261E', needsDetails: true,
    prompt: 'Case reference no. and current status:',
  },
  ONGOING_INVESTIGATION: {
    label: 'With ongoing investigation (no formal charge yet)', button: 'ONGOING INVESTIGATION', color: '#B3261E', needsDetails: true,
    prompt: 'Matter under investigation and action needed, if any:',
  },
  CERTIFY: {
    label: 'Certified', button: 'CERTIFY', color: '#1E7B34', final: true,
  },
  HOLD: {
    label: 'On Hold', button: 'HOLD', color: '#B3261E', needsDetails: true,
    prompt: 'Reason for hold and action needed before certification:',
  },
};

/** Which buttons each Part of CS Form No. 7 gets. */
const BUTTON_SETS = {
  II: ['CLEARED', 'NOT_CLEARED', 'EXTEND_OB'],
  III: ['CLEARED', 'NOT_CLEARED', 'EXTEND_OB'],
  IV: ['NO_PENDING_CASE', 'PENDING_ADMIN_CASE', 'ONGOING_INVESTIGATION'],
  V: ['CERTIFY', 'HOLD'],
};

/* ======================================================================== Phase 1 */

/** Original CS Form No. 7 Google Sheet. Copied once by setupSystem() into the template. */
const TEMPLATE_SOURCE_ID = '18c6WDzKDde3Ja8WZ0KfpvgcF1skEQ_eaEcWg1dc6SBs';
const FORM_SHEET = 'Clearance Form';

const FOLDERS = {
  ROOT: 'DAP E-Clearance System',
  TEMPLATE: 'Template',
  LIVE: 'Live Clearance Forms',
  COMPLETED: 'Completed Clearances',
};

const PURPOSES = ['Transfer', 'Retirement', 'Resignation', 'Leave', 'Other Mode of Separation'];

/** Parts in processing order (Guide: "Processing … shall follow the order of number indicated"). */
const PART_ORDER = ['II', 'III', 'IV', 'V'];

/**
 * Every signatory row on CS Form No. 7.
 *  step  = routing sequence (same step = parallel). Part II is sequential: Supervisor, then Head.
 *  cells = where the name, check marks and signature notation go on the 'Clearance Form' sheet.
 *  source 'request' = name/email typed by RSP at intake; 'directory' = Officers sheet.
 */
const SIGNATORY_ROWS = [
  { rowId: 'II-SUP', part: 'II', step: 1, source: 'request', office: 'Immediate Supervisor', cells: { name: 'D22' } },
  { rowId: 'II-HEAD', part: 'II', step: 2, source: 'request', office: 'Head of Office', cells: { name: 'J22' } },
  { rowId: 'III-1a', part: 'III', step: 3, source: 'directory', sheetRow: 27 },
  { rowId: 'III-1b', part: 'III', step: 3, source: 'directory', sheetRow: 28 },
  { rowId: 'III-1c', part: 'III', step: 3, source: 'directory', sheetRow: 29 },
  { rowId: 'III-2a', part: 'III', step: 3, source: 'directory', sheetRow: 31 },
  { rowId: 'III-2b', part: 'III', step: 3, source: 'directory', sheetRow: 32 },
  { rowId: 'III-3a', part: 'III', step: 3, source: 'directory', sheetRow: 34 },
  { rowId: 'III-3b', part: 'III', step: 3, source: 'directory', sheetRow: 35 },
  { rowId: 'III-3c', part: 'III', step: 3, source: 'directory', sheetRow: 36 },
  { rowId: 'III-4a', part: 'III', step: 3, source: 'directory', sheetRow: 38 },
  { rowId: 'IV-a', part: 'IV', step: 4, source: 'directory', sheetRow: 40 },
  { rowId: 'V-EVP', part: 'V', step: 5, source: 'directory', cells: { name: 'A50', sign: 'A49' } },
];

/** Stage highlight colours on the live form. */
const STAGE_COLORS = { DONE: '#E6F4EA', CURRENT: '#FFE699' };
