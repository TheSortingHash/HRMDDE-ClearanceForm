/**
 * TEST-ONLY helpers for Phase 3 (refused unless ECL.TEST_MODE is true).
 * Each one rewinds dates on the most recent in-progress clearance, then runs the daily checks,
 * so deemed clearance and reminders can be seen without waiting days.
 */

function testLatestRef_() {
  if (!ECL.TEST_MODE) throw new Error('Test helpers are disabled when TEST_MODE is false.');
  const open = readObjects_('Requests').filter((r) => r.Status === 'IN_PROGRESS');
  if (!open.length) throw new Error('No in-progress clearance to test with.');
  const req = open[open.length - 1];
  console.log(`Testing with ${req['Ref No']} — ${req['Employee Name (HRIS)']} (stage ${req.Stage})`);
  return req;
}

function testCurrentRows_(ref) {
  const sigs = getSignatories_(ref);
  return sigs.filter((s) => s.Status === SIG_STATUS.SENT && isCurrentStep_(s, sigs));
}

/** Working day `n` days before `d`. */
function testWorkingDaysAgo_(d, n) {
  const hol = holidaySet_();
  let x = new Date(d.getTime());
  let count = 0;
  while (count < n) {
    x = new Date(x.getTime() - 24 * 3600 * 1000);
    if (isWorkingDay_(x, hol)) count++;
  }
  return x;
}

/** Part II–III rows now SENT become overdue → deemed cleared on the run. */
function testDeemedClearance() {
  const req = testLatestRef_();
  const rows = testCurrentRows_(req['Ref No']).filter((s) => DEEMED_PARTS.indexOf(s.Part) >= 0);
  if (!rows.length) throw new Error('No Part II–III row is currently awaiting action.');
  const past = new Date(Date.now() - 60 * 1000);
  rows.forEach((s) => updateRow_('Signatories', s._row, { 'Due At': past }));
  console.log('Made overdue: ' + rows.map((s) => s['Row ID']).join(', '));
  runDailyChecks();
}

/** Current rows get a reminder on the run (II–III: due tomorrow; IV–V: sent 2 working days ago). */
function testReminders() {
  const req = testLatestRef_();
  const rows = testCurrentRows_(req['Ref No']);
  if (!rows.length) throw new Error('No row is currently awaiting action.');
  const now = new Date();
  rows.forEach((s) => {
    if (DEEMED_PARTS.indexOf(s.Part) >= 0) {
      updateRow_('Signatories', s._row, { 'Due At': addWorkingDays_(now, 1), 'Last Reminder At': '' });
    } else {
      updateRow_('Signatories', s._row, { 'Sent At': testWorkingDaysAgo_(now, 2), 'Last Reminder At': '' });
    }
  });
  console.log('Set up reminders for: ' + rows.map((s) => s['Row ID']).join(', '));
  if (!isWorkingDay_(now, holidaySet_())) console.log('Note: today is not a working day, so no reminders are sent today.');
  runDailyChecks();
}

/** Moves the Date of Effectivity 25 days back so the 30-day final reminder fires on the run. */
function testFinalReminder() {
  const req = testLatestRef_();
  const eff = new Date(Date.now() - FINAL_REMINDER_DAYS * 24 * 3600 * 1000);
  updateRow_('Requests', req._row, { 'Date of Effectivity': eff, 'Final Reminder At': '' });
  console.log(`Date of Effectivity set to ${fmtDate_(eff)} for testing.`);
  if (!isWorkingDay_(new Date(), holidaySet_())) console.log('Note: today is not a working day, so no reminders are sent today.');
  runDailyChecks();
}
