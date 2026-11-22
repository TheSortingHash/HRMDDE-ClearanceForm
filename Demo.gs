/**
 * DEMO MODE — for presentations and pilot runs.
 *
 * 1. In the DB, sheet **Demo**: type a participant's DAP email in "Demo Email" next to each clearing
 *    office (Part III rows, Legal, EVP). Leave a row blank to keep the real officer's email.
 * 2. Settings → DEMO_MODE = TRUE. New clearances are routed to the demo emails; the form still shows the
 *    real officers' names. Set DEMO_MODE = FALSE to go back to the Officers sheet.
 * 3. Dashboard (HRMDD admins): "Skip to Part III / IV / V" on any in-progress clearance clears the
 *    earlier rows as (DEMO) so the next signatory can act right away.
 * 4. Changed a demo email mid-demo? Run refreshDemoAssignments() from the editor.
 *
 * Demo mode is also on whenever ECL.TEST_MODE is true.
 */
function demoEnabled_() {
  return ECL.TEST_MODE || /^(true|yes|on|1)$/i.test(String(setting_('DEMO_MODE') || '').trim());
}

/** Row ID → { email, alternate } for rows with a Demo Email, when demo mode is on. */
function demoOverrides_() {
  const out = {};
  if (!demoEnabled_()) return out;
  let rows = [];
  try { rows = readObjects_('Demo'); } catch (err) { return out; }
  rows.forEach((r) => {
    const email = String(r['Demo Email'] || '').trim().toLowerCase();
    if (r['Row ID'] && email) {
      out[r['Row ID']] = { email, alternate: String(r['Demo Alternate Email'] || '').trim().toLowerCase() };
    }
  });
  return out;
}

/** All demo emails (for portal access while demo mode is on). */
function demoEmails_() {
  const o = demoOverrides_();
  return Object.keys(o).reduce((a, k) => a.concat([o[k].email, o[k].alternate]), []).filter(Boolean);
}

/**
 * Clears every not-yet-cleared row before the first step of `targetPart` (III, IV or V) as (DEMO),
 * re-renders the form and routes to the next signatory.
 */
function fastForward_(ref, targetPart, actor) {
  const target = SIGNATORY_ROWS.find((r) => r.part === targetPart);
  if (!target || targetPart === 'II') throw new Error('Choose Part III, IV or V.');
  return withLock_(() => {
    const req = getRequest_(ref);
    if (req.Status !== 'IN_PROGRESS') throw new Error(`${ref} is not in progress.`);
    const sigs = getSignatories_(ref);
    const ss = SpreadsheetApp.openById(req['Live Form ID']);
    const now = new Date();
    const rows = sigs.filter((s) => Number(s.Step) < target.step && !isDone_(s));
    if (!rows.length) throw new Error(`${ref} is already at Part ${targetPart} or later.`);
    rows.forEach((s) => {
      const changes = {
        Status: SIG_STATUS.CLEARED, Action: 'CLEARED', 'Action At': now, 'Acted By': `DEMO (${actor})`,
        Details: '', Notation: `Electronically signed by ${s['Officer Name']} · ${fmtDateTime_(now)} (DEMO)`,
      };
      updateRow_('Signatories', s._row, changes);
      Object.assign(s, changes);
      renderSignatory_(ss, s, sigs);
    });
    audit_(ref, actor, 'DEMO_FAST_FORWARD', `to Part ${targetPart}: ${rows.map((s) => s['Row ID']).join(', ')}`);
    advance_(ref);
    return `${ref}: ${rows.length} row(s) cleared (DEMO). Part ${targetPart} has been notified.`;
  });
}

/**
 * Re-points rows not yet acted on (WAITING or SENT) of every in-progress clearance to the current Demo
 * emails, shares the live form with them, and re-sends "Action needed" for rows already SENT.
 */
function refreshDemoAssignments() {
  if (!demoEnabled_()) throw new Error('Settings → DEMO_MODE is not TRUE.');
  const o = demoOverrides_();
  let moved = 0;
  readObjects_('Requests').filter((r) => r.Status === 'IN_PROGRESS').forEach((req) => {
    const sigs = getSignatories_(req['Ref No']);
    const changed = [];
    sigs.forEach((s) => {
      const d = o[s['Row ID']];
      if (!d || [SIG_STATUS.WAITING, SIG_STATUS.SENT].indexOf(s.Status) < 0) return;
      if (String(s['Officer Email']).toLowerCase() === d.email && String(s['Alternate Email'] || '').toLowerCase() === d.alternate) return;
      updateRow_('Signatories', s._row, { 'Officer Email': d.email, 'Alternate Email': d.alternate });
      Object.assign(s, { 'Officer Email': d.email, 'Alternate Email': d.alternate });
      changed.push(s);
    });
    if (!changed.length) return;
    shareViewOnly_(req['Live Form ID'], changed.map((s) => s['Officer Email']).concat(changed.map((s) => s['Alternate Email'])));
    const sent = changed.filter((s) => s.Status === SIG_STATUS.SENT && isCurrentStep_(s, sigs));
    if (sent.length) notifyOfficers_(req, sent, null, { kind: 'REQUEST' });
    audit_(req['Ref No'], currentUser_() || ECL.HOST_EMAIL, 'DEMO_REASSIGN', changed.map((s) => s['Row ID']).join(', '));
    moved += changed.length;
  });
  console.log(`Re-assigned ${moved} row(s) to the current Demo emails.`);
}

/** Admin dashboard button. */
function adminFastForward(ref, part) {
  const admin = requireAdmin_();
  if (!demoEnabled_()) throw new Error('Fast-forward is only available in demo mode (Settings → DEMO_MODE).');
  const message = fastForward_(ref, part, admin);
  return { message, data: adminData() };
}
