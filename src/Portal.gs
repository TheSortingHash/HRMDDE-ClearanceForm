/**
 * Officer Portal and HRMDD All-Clearances dashboard (server side).
 * Everything here runs as the host account; the signed-in DAP user only ever sees and acts on
 * rows assigned to them (or, for HRMDD admins, the dashboard).
 */

function isAdmin_(email) {
  return !!email && settingList_('HRMDD_ADMINS').indexOf(email) >= 0;
}

function officerPortalPage_(user, p) {
  const t = HtmlService.createTemplateFromFile('Portal');
  t.user = user;
  t.isAdmin = isAdmin_(user);
  t.isRsp = isRspUser_(user);
  t.focusRef = String(p.ref || '');
  t.startTab = p.page === 'admin' && t.isAdmin ? 'admin' : 'pending';
  t.intakeUrl = `${webAppUrl_()}?page=intake`;
  t.logo = ECL.BRAND.LOGO;
  t.testMode = ECL.TEST_MODE;
  return t.evaluate()
    .setTitle('DAP E-Clearance Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ------------------------------------------------------------------ officer API */

/** Pending and recently-acted rows for the signed-in officer (dates as display strings). */
function portalData() {
  const user = currentUser_();
  const reqs = {};
  readObjects_('Requests').forEach((r) => (reqs[r['Ref No']] = r));
  const all = readObjects_('Signatories');
  const byRef = {};
  all.forEach((s) => (byRef[s['Ref No']] = byRef[s['Ref No']] || []).push(s));
  const mine = all.filter((s) => isAssigned_(s, user) && reqs[s['Ref No']]);
  const hol = holidaySet_();
  const now = new Date();

  const groups = {};
  mine.filter((s) => ACTIONABLE_STATUSES.indexOf(s.Status) >= 0 && reqs[s['Ref No']].Status === 'IN_PROGRESS')
    .forEach((s) => {
      const r = reqs[s['Ref No']];
      if (!groups[r['Ref No']]) groups[r['Ref No']] = { ...requestView_(r), rows: [] };
      const current = isCurrentStep_(s, byRef[s['Ref No']]);
      const left = s['Due At'] instanceof Date ? workingDaysLeft_(s['Due At'], now, hol) : null;
      groups[r['Ref No']].rows.push({
        rowId: s['Row ID'], part: s.Part, office: s.Office, status: s.Status,
        sentAt: fmtDateTime_(s['Sent At']), dueAt: fmtDate_(s['Due At']), daysLeft: left,
        extended: isTrue_(s.Extended), details: s.Details || '', action: s.Action || '',
        deemedApplies: DEEMED_PARTS.indexOf(s.Part) >= 0,
        blocked: !current,
        actions: (current ? availableActions_(s) : []).map((a) => ({
          key: a, label: ACTIONS[a].button, color: ACTIONS[a].color,
          needsDetails: !!ACTIONS[a].needsDetails, prompt: ACTIONS[a].prompt || '', full: ACTIONS[a].label,
        })),
      });
    });

  const acted = mine.filter((s) => s['Action At'] instanceof Date)
    .sort((a, b) => b['Action At'] - a['Action At']).slice(0, 50)
    .map((s) => ({
      ref: s['Ref No'], employee: reqs[s['Ref No']]['Employee Name (HRIS)'], office: s.Office,
      part: s.Part, status: s.Status, action: ACTIONS[s.Action] ? ACTIONS[s.Action].label : s.Status,
      at: fmtDateTime_(s['Action At']), liveUrl: reqs[s['Ref No']]['Live Form URL'],
    }));

  return {
    user,
    minDetails: ECL.MIN_DETAILS_LENGTH,
    pending: Object.keys(groups).map((k) => groups[k])
      .sort((a, b) => a.employee.localeCompare(b.employee)),
    acted,
  };
}

function portalAct(ref, rowId, action, details) {
  const message = applyAction_(currentUser_(), ref, rowId, action, details);
  return { message, data: portalData() };
}

function requestView_(r) {
  return {
    ref: r['Ref No'], employee: r['Employee Name (HRIS)'], position: r['Position/SG/Step'],
    office: r['Office of Assignment'],
    purpose: r.Purpose === 'Other Mode of Separation' ? `Other: ${r['Other Purpose']}` : r.Purpose,
    effectivity: formatLongDate_(r['Date of Effectivity']), filed: fmtDate_(r['Filed At']),
    status: r.Status, stage: r.Stage, liveUrl: r['Live Form URL'], pdfUrl: r['PDF URL'] || '',
  };
}

/* ------------------------------------------------------------------ admin API */

function requireAdmin_() {
  const user = currentUser_();
  if (!isAdmin_(user)) throw new Error('HRMDD admin access is required.');
  return user;
}

/** All clearances, alphabetical by employee, with each signatory's status. */
function adminData() {
  requireAdmin_();
  const bySig = {};
  readObjects_('Signatories').forEach((s) => (bySig[s['Ref No']] = bySig[s['Ref No']] || []).push(s));
  const folder = (k) => (prop_('FOLDER_' + k) ? `https://drive.google.com/drive/folders/${prop_('FOLDER_' + k)}` : '');

  const list = readObjects_('Requests').map((r) => {
    const sigs = (bySig[r['Ref No']] || []).sort((a, b) => Number(a.Step) - Number(b.Step));
    return {
      ...requestView_(r),
      done: sigs.filter(isDone_).length,
      total: sigs.length,
      flagged: sigs.filter((s) => s.Status === SIG_STATUS.NOT_CLEARED || s.Status === SIG_STATUS.HOLD).length,
      completedAt: fmtDate_(r['Completed At']),
      rows: sigs.map((s) => ({
        rowId: s['Row ID'], part: s.Part, office: s.Office, officer: s['Officer Name'],
        email: s['Officer Email'], status: s.Status, sentAt: fmtDate_(s['Sent At']), dueAt: fmtDate_(s['Due At']),
        actedAt: fmtDateTime_(s['Action At']), actedBy: s['Acted By'] || '', details: s.Details || '',
        notation: s.Notation || '',
        reopenable: r.Status !== 'COMPLETED' && [SIG_STATUS.CLEARED, SIG_STATUS.DEEMED_CLEARED,
          SIG_STATUS.NOT_CLEARED, SIG_STATUS.HOLD].indexOf(s.Status) >= 0,
      })),
    };
  }).sort((a, b) => a.employee.localeCompare(b.employee));

  return {
    list,
    links: {
      root: folder('ROOT'), live: folder('LIVE'), completed: folder('COMPLETED'), template: folder('TEMPLATE'),
      db: prop_('DB_ID') ? `https://docs.google.com/spreadsheets/d/${prop_('DB_ID')}/edit` : '',
    },
  };
}

function adminReopen(ref, rowId, reason) {
  const admin = requireAdmin_();
  const message = adminReopen_(admin, ref, rowId, reason);
  return { message, data: adminData() };
}
