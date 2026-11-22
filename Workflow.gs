/**
 * Workflow engine: routing (Part II Supervisor → Part II Head → Part III in parallel → Part IV
 * → Part V), recording actions, writing notations on the live form, and HRMDD reopen.
 * Callers that change data hold the script lock.
 */
const DONE_STATUSES = [SIG_STATUS.CLEARED, SIG_STATUS.DEEMED_CLEARED];
const ACTIONABLE_STATUSES = [SIG_STATUS.SENT, SIG_STATUS.NOT_CLEARED, SIG_STATUS.HOLD];

function isDone_(s) {
  return DONE_STATUSES.indexOf(s.Status) >= 0;
}

function getRequest_(ref) {
  const r = readObjects_('Requests').find((x) => x['Ref No'] === ref);
  if (!r) throw new Error(`Clearance ${ref} not found.`);
  return r;
}

function getSignatories_(ref) {
  return readObjects_('Signatories').filter((s) => s['Ref No'] === ref);
}

function fmtDateTime_(d) {
  return d instanceof Date ? Utilities.formatDate(d, TZ, 'd MMM yyyy, h:mm a') : '';
}

function fmtDate_(d) {
  return d instanceof Date ? Utilities.formatDate(d, TZ, 'd MMM yyyy') : '';
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ routing */

/**
 * Moves a clearance forward: finds the lowest step that is not fully cleared, emails any of its
 * signatories that have not been sent yet, updates the stage highlight, or completes the request.
 */
function advance_(ref) {
  const req = getRequest_(ref);
  const sigs = getSignatories_(ref);
  const ss = SpreadsheetApp.openById(req['Live Form ID']);
  const open = sigs.filter((s) => !isDone_(s));

  if (!open.length) {
    updateRow_('Requests', req._row, { Status: 'SIGNED', Stage: 'COMPLETED', 'Completed At': new Date() });
    highlightStage_(ss, 'COMPLETED');
    audit_(ref, 'system', 'ALL_SIGNED', '');
    tryFinalize_(ref, 'system'); // PDF + QR + notice; on failure the employee is told HRMDD will issue it
    return;
  }

  const step = Math.min.apply(null, open.map((s) => Number(s.Step)));
  const part = open.find((s) => Number(s.Step) === step).Part;
  if (req.Stage !== part) updateRow_('Requests', req._row, { Stage: part });
  highlightStage_(ss, part);

  const toSend = sigs.filter((s) => Number(s.Step) === step &&
    (s.Status === SIG_STATUS.WAITING || s.Status === SIG_STATUS.QUEUED));
  if (!toSend.length) return;

  const now = new Date();
  const due = addWorkingDays_(now, DEADLINE.NORMAL);
  toSend.forEach((s) => {
    updateRow_('Signatories', s._row, { Status: SIG_STATUS.SENT, 'Sent At': now, 'Due At': due });
    Object.assign(s, { Status: SIG_STATUS.SENT, 'Sent At': now, 'Due At': due });
  });
  notifyOfficers_(req, toSend, due);
  audit_(ref, 'system', 'SENT', toSend.map((s) => s['Row ID']).join(', '));
}

/* ------------------------------------------------------------------ actions */

/** Buttons the portal offers for a row in its current state. */
function availableActions_(sig) {
  const set = BUTTON_SETS[sig.Part] || [];
  if (sig.Status === SIG_STATUS.SENT) {
    return set.filter((a) => a !== 'EXTEND_OB' || !isTrue_(sig.Extended));
  }
  if (sig.Status === SIG_STATUS.NOT_CLEARED || sig.Status === SIG_STATUS.HOLD) {
    return set.filter((a) => a !== 'EXTEND_OB');
  }
  return [];
}

/** True when every signatory of an earlier step is done (e.g. Part V waits for a reopened Part III row). */
function isCurrentStep_(sig, sigs) {
  return !sigs.some((s) => Number(s.Step) < Number(sig.Step) && !isDone_(s));
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function isAssigned_(sig, email) {
  const e = String(email || '').toLowerCase();
  return !!e && (String(sig['Officer Email']).toLowerCase() === e ||
    String(sig['Alternate Email']).toLowerCase() === e);
}

/** Records an officer's action from the portal. Returns a confirmation message. */
function applyAction_(user, ref, rowId, action, details) {
  return withLock_(() => {
    const def = ACTIONS[action];
    if (!def) throw new Error('Unknown action.');
    const req = getRequest_(ref);
    if (req.Status !== 'IN_PROGRESS') throw new Error(`Clearance ${ref} is no longer in progress.`);
    const sigs = getSignatories_(ref);
    const sig = sigs.find((s) => s['Row ID'] === rowId);
    if (!sig) throw new Error('Row not found.');
    if (!isAssigned_(sig, user)) throw new Error('This row is assigned to a different officer.');
    if (sig.Status === SIG_STATUS.WAITING || !isCurrentStep_(sig, sigs)) {
      throw new Error('This row is not yet due for your action: an earlier Part of the clearance is still open.');
    }
    if (sig.Status === SIG_STATUS.SENT && DEEMED_PARTS.indexOf(sig.Part) >= 0 &&
      sig['Due At'] instanceof Date && new Date() > sig['Due At']) {
      // The deadline has passed: the row locks and deemed clearance applies now (§III.E), for fairness.
      applyDeemedClearance_(req, sigs, new Date());
      throw new Error(`The deadline for this row (${fmtDate_(sig['Due At'])}) has passed, so the employee has been ` +
        'deemed cleared by your office (MC-2026-014 §III.E). If there is an outstanding accountability, please inform HRMDD.');
    }
    if (isDone_(sig)) {
      throw new Error(`This row was already recorded (${sig.Status}) on ${fmtDateTime_(sig['Action At'])}. Only HRMDD can reopen it.`);
    }
    if (availableActions_(sig).indexOf(action) < 0) throw new Error(`"${def.label}" is not available for this row.`);

    if (action === 'EXTEND_OB') {
      const due = addWorkingDays_(sig['Sent At'], DEADLINE.EXTENDED);
      updateRow_('Signatories', sig._row, { Extended: true, 'Due At': due });
      audit_(ref, user, 'EXTEND_OB', `${rowId} due ${fmtDate_(due)}`);
      return `Deadline extended to ${fmtDate_(due)} (7 working days).`;
    }

    const text = String(details || '').trim();
    if (def.needsDetails && text.length < ECL.MIN_DETAILS_LENGTH) {
      throw new Error(`Please give specific details (at least ${ECL.MIN_DETAILS_LENGTH} characters): the item and the action the employee must take.`);
    }

    const now = new Date();
    const isAlt = String(sig['Officer Email']).toLowerCase() !== user;
    const signer = isAlt ? `${sig['Alternate Name'] || user} (alternate)` : sig['Officer Name'];
    const changes = {
      Status: def.result, Action: action, 'Action At': now, 'Acted By': user,
      Details: def.needsDetails ? text : '',
      Notation: def.result === SIG_STATUS.CLEARED ? `Electronically signed by ${signer} · ${fmtDateTime_(now)}` : '',
    };
    updateRow_('Signatories', sig._row, changes);
    Object.assign(sig, changes);

    renderSignatory_(SpreadsheetApp.openById(req['Live Form ID']), sig, sigs);
    audit_(ref, user, action, { row: rowId, details: changes.Details });

    if (def.result === SIG_STATUS.CLEARED) notifySigned_(req, sig, def);
    else if (def.result === SIG_STATUS.NOT_CLEARED) notifyAccountability_(req, sig, def, user);
    else if (def.result === SIG_STATUS.HOLD) notifyHold_(req, sig, user);

    if (def.result === SIG_STATUS.CLEARED) advance_(ref);
    return `${def.label} recorded for ${sig.Office}.`;
  });
}

/** HRMDD admin: returns a row to the officer for action again. */
function adminReopen_(admin, ref, rowId, reason) {
  return withLock_(() => {
    const why = String(reason || '').trim();
    if (why.length < 10) throw new Error('Please state the reason for reopening (at least 10 characters).');
    const req = getRequest_(ref);
    if (req.Status === 'COMPLETED') throw new Error('This clearance is completed and its PDF has been issued.');
    const sigs = getSignatories_(ref);
    const sig = sigs.find((s) => s['Row ID'] === rowId);
    if (!sig) throw new Error('Row not found.');
    if ([SIG_STATUS.CLEARED, SIG_STATUS.DEEMED_CLEARED, SIG_STATUS.NOT_CLEARED, SIG_STATUS.HOLD].indexOf(sig.Status) < 0) {
      throw new Error('Only rows that have been acted on can be reopened.');
    }

    const now = new Date();
    const due = addWorkingDays_(now, DEADLINE.NORMAL);
    const changes = {
      Status: SIG_STATUS.SENT, Action: '', 'Action At': '', 'Acted By': '', Details: '', Notation: '',
      'Sent At': now, 'Due At': due, Extended: false,
    };
    updateRow_('Signatories', sig._row, changes);
    Object.assign(sig, changes);

    // Later steps that were sent but not acted on go back to waiting.
    sigs.filter((s) => Number(s.Step) > Number(sig.Step) && s.Status === SIG_STATUS.SENT).forEach((s) => {
      updateRow_('Signatories', s._row, { Status: SIG_STATUS.WAITING, 'Sent At': '', 'Due At': '' });
      s.Status = SIG_STATUS.WAITING;
    });
    updateRow_('Requests', req._row, { Status: 'IN_PROGRESS', Stage: sig.Part, 'Completed At': '' });

    const ss = SpreadsheetApp.openById(req['Live Form ID']);
    renderSignatory_(ss, sig, sigs);
    highlightStage_(ss, sig.Part);
    audit_(ref, admin, 'REOPEN', { row: rowId, reason: why });

    notifyOfficers_(req, [sig], due, { reopenReason: why });
    notifyReopened_(req, sig, why);
    return `${sig.Office} reopened and sent back to ${sig['Officer Name']}.`;
  });
}

/* ------------------------------------------------------------------ live form rendering */

/** Writes one signatory's current state (ticks, notation) onto the live form. */
function renderSignatory_(ss, sig, allSigs) {
  const key = sigKey_(sig['Row ID']);
  const cleared = isDone_(sig);
  const notCleared = sig.Status === SIG_STATUS.NOT_CLEARED;

  if (sig.Part === 'II') {
    const cell = named_(ss, `ECL_SIG_${key}_NAME`);
    setNameWithNotation_(cell, sig['Officer Name'], sig.Notation);
    cell.getSheet().setRowHeight(cell.getRow(), fs_(sig.Notation ? 34 : 18));
    const part2 = allSigs.filter((s) => s.Part === 'II');
    setPartIIStatement_(ss, part2.every(isDone_), part2.some((s) => s.Status === SIG_STATUS.NOT_CLEARED));
    return;
  }

  if (sig.Part === 'V') {
    const cell = named_(ss, `ECL_SIG_${key}_SIGN`);
    cell.setValue(sig.Notation || '').setFontFamily('Arial').setFontSize(fs_(8)).setFontStyle('italic')
      .setFontColor(ECL.BRAND.NAVY).setHorizontalAlignment('center').setVerticalAlignment('bottom');
    const sheet = cell.getSheet();
    sheet.showRows(cell.getRow());
    sheet.setRowHeight(cell.getRow(), fs_(20));
    return;
  }

  named_(ss, `ECL_SIG_${key}_CLEARED`).setValue(cleared ? '✔' : '').setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  if (sig.Part === 'III') {
    named_(ss, `ECL_SIG_${key}_NOTCLEARED`).setValue(notCleared ? '✔' : '').setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
  } else if (sig.Part === 'IV') {
    setBox_(named_(ss, 'ECL_IV_PENDING_CASE'), notCleared && sig.Action === 'PENDING_ADMIN_CASE');
    setBox_(named_(ss, 'ECL_IV_INVESTIGATION'), notCleared && sig.Action === 'ONGOING_INVESTIGATION');
  }
  const sign = named_(ss, `ECL_SIG_${key}_SIGN`);
  sign.setValue(sig.Notation || '').setFontFamily('Arial').setFontSize(fs_(7)).setFontStyle('italic')
    .setFontColor(ECL.BRAND.NAVY).setWrap(true).setVerticalAlignment('middle');
  if (sig.Notation) sign.getSheet().setRowHeight(sign.getRow(), fs_(40));
}

/** Part II name cell: bold name, plus a small italic notation line once signed. */
function setNameWithNotation_(cell, name, notation) {
  const text = notation ? `${name}\n${notation}` : String(name);
  const b = SpreadsheetApp.newRichTextValue().setText(text)
    .setTextStyle(0, String(name).length, SpreadsheetApp.newTextStyle().setBold(true).build());
  if (notation) {
    b.setTextStyle(String(name).length + 1, text.length, SpreadsheetApp.newTextStyle()
      .setBold(false).setItalic(true).setFontSize(fs_(7)).setForegroundColor(ECL.BRAND.NAVY).build());
  }
  cell.setRichTextValue(b.build()).setWrap(true);
}

function setPartIIStatement_(ss, cleared, notCleared) {
  named_(ss, 'ECL_II_STATEMENT').setValue(
    `We hereby certify that this employee is ${cleared ? BOX_TICKED : BOX_EMPTY} cleared   ` +
    `${notCleared ? BOX_TICKED : BOX_EMPTY} not cleared   ` +
    'of work-related accountabilities from this Unit/Office/Dept.');
}
