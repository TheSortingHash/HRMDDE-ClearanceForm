/**
 * Working-day arithmetic (MC-2026-014 §III.C.2): weekends and the dates in the Holidays sheet
 * (regular/special non-working holidays and work suspensions) are not counted.
 * All dates are evaluated in Asia/Manila.
 */
const TZ = 'Asia/Manila';

function dayKey_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** Set of 'yyyy-MM-dd' strings from the Holidays sheet. */
function holidaySet_() {
  const set = new Set();
  readObjects_('Holidays').forEach((h) => {
    if (h.Date instanceof Date) set.add(dayKey_(h.Date));
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(h.Date).trim())) set.add(String(h.Date).trim());
  });
  return set;
}

function isWorkingDay_(d, holidays) {
  const dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1 = Monday … 7 = Sunday
  return dow <= 5 && !holidays.has(dayKey_(d));
}

/** End (23:59:59 PHT) of the n-th working day after `start`. Day 1 = the next working day. */
function addWorkingDays_(start, n, holidays) {
  const hol = holidays || holidaySet_();
  let d = new Date(start.getTime());
  let count = 0;
  while (count < n) {
    d = new Date(d.getTime() + 24 * 3600 * 1000);
    if (isWorkingDay_(d, hol)) count++;
  }
  return new Date(`${dayKey_(d)}T23:59:59+08:00`);
}

/**
 * Working days left before `due`, counting from tomorrow. 0 = due today, negative = overdue.
 */
function workingDaysLeft_(due, now, holidays) {
  const hol = holidays || holidaySet_();
  const today = dayKey_(now || new Date());
  const dueKey = dayKey_(due);
  if (dueKey < today) return -1;
  let d = new Date(`${today}T12:00:00+08:00`);
  let left = 0;
  while (dayKey_(d) < dueKey) {
    d = new Date(d.getTime() + 24 * 3600 * 1000);
    if (isWorkingDay_(d, hol)) left++;
  }
  return left;
}
