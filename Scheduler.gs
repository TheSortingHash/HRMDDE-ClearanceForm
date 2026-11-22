/**
 * Phase 3 — daily checks (time trigger, 7 AM Manila). Installed by setupSystem() / installTriggers().
 *
 *  1. Deemed clearance (Parts II–III, §III.E): a SENT row past its due date becomes DEEMED_CLEARED;
 *     the officer (cc clearance@) and the employee (update thread) are notified; routing advances.
 *     Applied every day.
 *  2. Reminders (working days only):
 *     - Parts II–III: once when 1 working day is left (again if the deadline was extended).
 *     - Parts IV–V: every 2 working days while SENT, cc clearance@.
 *  3. 30-day reminder (§III.D.3): 25 calendar days after the Date of Effectivity, every Part II–IV
 *     signatory still SENT or NOT_CLEARED gets a final reminder, and the employee is told. Once per clearance.
 */
const FINAL_REMINDER_DAYS = 25;   // = 30-day deadline minus 5 days
const SETTLEMENT_DAYS = 30;       // §III.D.3, calendar days from separation
const FINAL_REMINDER_PARTS = ['II', 'III', 'IV'];

function runDailyChecks() {
  const summary = { deemed: 0, reminders: 0, finalReminders: 0, errors: 0 };
  withLock_(() => {
    const now = new Date();
    const hol = holidaySet_();
    const working = isWorkingDay_(now, hol);
    const requests = readObjects_('Requests').filter((r) => r.Status === 'IN_PROGRESS');
    if (!requests.length) return;
    const allSigs = readObjects_('Signatories');

    requests.forEach((req) => {
      const ref = req['Ref No'];
      try {
        summary.deemed += applyDeemedClearance_(req, allSigs.filter((s) => s['Ref No'] === ref), now);
        if (!working) return;
        const sigs = getSignatories_(ref); // fresh: deemed clearance may have advanced routing
        const current = getRequest_(ref);
        if (current.Status !== 'IN_PROGRESS') return;
        summary.reminders += sendDueReminders_(current, sigs, now, hol);
        summary.finalReminders += sendFinalReminder_(current, sigs, now);
      } catch (err) {
        summary.errors++;
        console.error(`${ref}: ${err.stack || err}`);
        audit_(ref, 'system', 'DAILY_ERROR', String(err.message || err));
      }
    });
  });
  console.log('Daily checks: ' + JSON.stringify(summary));
  return summary;
}

/** Marks overdue Part II–III rows as deemed cleared. Returns the number of rows changed. */
function applyDeemedClearance_(req, sigs, now) {
  const overdue = sigs.filter((s) => s.Status === SIG_STATUS.SENT && DEEMED_PARTS.indexOf(s.Part) >= 0 &&
    s['Due At'] instanceof Date && now > s['Due At'] && isCurrentStep_(s, sigs));
  if (!overdue.length) return 0;

  const ss = SpreadsheetApp.openById(req['Live Form ID']);
  overdue.forEach((s) => {
    const changes = {
      Status: SIG_STATUS.DEEMED_CLEARED, Action: 'DEEMED', 'Action At': now, 'Acted By': 'system',
      Notation: `Deemed cleared (MC-2026-014 §III.E) · ${fmtDateTime_(now)}`,
    };
    updateRow_('Signatories', s._row, changes);
    Object.assign(s, changes);
    renderSignatory_(ss, s, sigs);
    audit_(req['Ref No'], 'system', 'DEEMED_CLEARED', `${s['Row ID']} (due ${fmtDate_(s['Due At'])})`);
    notifyDeemedOfficer_(req, s);
    notifyDeemedEmployee_(req, s);
  });
  advance_(req['Ref No']);
  return overdue.length;
}

/** Whether a SENT row should get a reminder today. */
function reminderDue_(s, now, hol) {
  const last = s['Last Reminder At'] instanceof Date ? s['Last Reminder At'] : null;
  if (DEEMED_PARTS.indexOf(s.Part) >= 0) {
    if (!(s['Due At'] instanceof Date)) return false;
    const left = workingDaysLeft_(s['Due At'], now, hol);
    if (left < 0 || left > 1) return false;
    // Not yet reminded for this deadline (an extension moves the deadline and allows a new reminder).
    return !last || workingDaysLeft_(s['Due At'], last, hol) > 1;
  }
  const since = last || (s['Sent At'] instanceof Date ? s['Sent At'] : null);
  return !!since && workingDaysBetween_(since, now, hol) >= 2;
}

function sendDueReminders_(req, sigs, now, hol) {
  const due = sigs.filter((s) => s.Status === SIG_STATUS.SENT && isCurrentStep_(s, sigs) && reminderDue_(s, now, hol));
  if (!due.length) return 0;
  notifyOfficers_(req, due, null, { kind: 'REMINDER' });
  due.forEach((s) => updateRow_('Signatories', s._row, { 'Last Reminder At': now }));
  audit_(req['Ref No'], 'system', 'REMINDER', due.map((s) => s['Row ID']).join(', '));
  return due.length;
}

/** 5 days before the 30-day settlement deadline. Returns 1 if sent. */
function sendFinalReminder_(req, sigs, now) {
  const eff = req['Date of Effectivity'];
  if (req['Final Reminder At'] || !(eff instanceof Date)) return 0;
  const remindOn = new Date(eff.getTime() + FINAL_REMINDER_DAYS * 24 * 3600 * 1000);
  if (dayKey_(now) < dayKey_(remindOn)) return 0;

  const deadline = new Date(eff.getTime() + SETTLEMENT_DAYS * 24 * 3600 * 1000);
  const pending = sigs.filter((s) => FINAL_REMINDER_PARTS.indexOf(s.Part) >= 0 &&
    (s.Status === SIG_STATUS.SENT || s.Status === SIG_STATUS.NOT_CLEARED));
  updateRow_('Requests', req._row, { 'Final Reminder At': now });
  if (!pending.length) return 0;

  notifyOfficers_(req, pending, null, { kind: 'FINAL', finalDeadline: deadline });
  notifyFinalEmployee_(req, pending, deadline);
  audit_(req['Ref No'], 'system', 'FINAL_REMINDER', pending.map((s) => s['Row ID']).join(', '));
  return 1;
}

/** Installs (or re-installs) the daily 7 AM trigger. */
function installTriggers() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runDailyChecks')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('runDailyChecks').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  console.log('Daily checks scheduled for 7 AM (Asia/Manila).');
}
