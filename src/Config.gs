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
  MIN_DETAILS_LENGTH: 10,
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
    prompt: 'Describe the accountability and the specific action the employee must take to settle it:',
  },
  EXTEND_OB: {
    label: 'On Official Business / Leave (extended to 7 working days)', button: 'ON OB / LEAVE', color: '#5F6368',
  },
  NO_PENDING_CASE: {
    label: 'No pending administrative case', button: 'NO PENDING CASE', color: '#1E7B34', final: true,
  },
  PENDING_ADMIN_CASE: {
    label: 'With pending administrative case', button: 'WITH PENDING ADMIN CASE', color: '#B3261E', needsDetails: true,
    prompt: 'Specify the case (reference/docket no.) and its current status:',
  },
  ONGOING_INVESTIGATION: {
    label: 'With ongoing investigation (no formal charge yet)', button: 'ONGOING INVESTIGATION', color: '#B3261E', needsDetails: true,
    prompt: 'Specify the matter under investigation and what is needed from the employee, if any:',
  },
  CERTIFY: {
    label: 'Certified', button: 'CERTIFY', color: '#1E7B34', final: true,
  },
  HOLD: {
    label: 'On Hold', button: 'HOLD', color: '#B3261E', needsDetails: true,
    prompt: 'State the reason for the hold and what must be done before certification:',
  },
};

/** Which buttons each Part of CS Form No. 7 gets. */
const BUTTON_SETS = {
  II: ['CLEARED', 'NOT_CLEARED', 'EXTEND_OB'],
  III: ['CLEARED', 'NOT_CLEARED', 'EXTEND_OB'],
  IV: ['NO_PENDING_CASE', 'PENDING_ADMIN_CASE', 'ONGOING_INVESTIGATION'],
  V: ['CERTIFY', 'HOLD'],
};
