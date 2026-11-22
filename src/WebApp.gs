/**
 * Web app entry point (one deployment, several pages).
 * Deploy as: Execute as "Me (comben@dap.edu.ph)", Who has access "Anyone within DAP".
 * The signed-in DAP account is read from Session.getActiveUser(); nobody but the host account
 * needs edit access to the DB or the forms.
 *
 * Routes:
 *   ?page=intake            RSP intake form (RSP_USERS only). Default for RSP users.
 *   ?page=officer[&ref=…]   Officer Portal — pending clearances and actions.
 *   ?page=admin             All-Clearances dashboard (HRMDD_ADMINS only).
 *   ?verify=<ref>           QR verification page (Phase 4).
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const user = currentUser_();
  const page = p.page || (isRspUser_(user) ? 'intake' : 'officer');

  if (page === 'officer' || page === 'admin') return officerPortalPage_(user, p);
  if (!isRspUser_(user)) {
    return messagePage_('Access Restricted', `
      <p>The E-Clearance intake form is limited to the HRMDD Recruitment, Selection and Placement Unit.</p>
      <p>You are signed in as <b>${escapeHtml_(user || 'an unknown account')}</b>. If you need access,
      please contact HRMDD.</p>`);
  }
  return intakePage_(user);
}

function messagePage_(title, html) {
  return HtmlService.createHtmlOutput(brandedEmail_(title, html))
    .setTitle('DAP E-Clearance System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function intakePage_(user) {
  const t = HtmlService.createTemplateFromFile('Intake');
  t.user = user;
  t.logo = ECL.BRAND.LOGO;
  t.purposes = PURPOSES;
  t.today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
  t.testMode = ECL.TEST_MODE;
  t.portalUrl = `${webAppUrl_()}?page=officer`;
  return t.evaluate()
    .setTitle('DAP E-Clearance — New Clearance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from Intake.html via google.script.run. */
function submitIntake(form) {
  const user = currentUser_();
  if (!isRspUser_(user)) throw new Error('You are not authorized to file clearances.');
  const v = validateIntake_(form);
  if (v.errors.length) throw new Error(v.errors.join('\n'));
  return createClearance_(v.data, user);
}

function currentUser_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}

function isRspUser_(email) {
  return !!email && settingList_('RSP_USERS').indexOf(email) >= 0;
}

/* ------------------------------------------------------------------ validation */

const DAP_EMAIL_RE_ = /^[^\s@]+@dap\.edu\.ph$/i;
const EMAIL_RE_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HRIS_NAME_RE_ = /^[A-ZÑ][A-ZÑ .'-]*,\s*[A-ZÑ][A-ZÑ .'-]*$/;

/** Pure validation (no Google services) so it can be unit-tested. Returns {errors, data}. */
function validateIntake_(f) {
  const errors = [];
  const str = (k) => String((f && f[k]) || '').trim().replace(/\s+/g, ' ');
  const date = (k, label) => {
    const m = str(k).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { errors.push(`${label} is required.`); return null; }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };

  const data = {
    office: str('office'),
    positionTitle: str('positionTitle'),
    sg: str('sg'),
    step: str('step'),
    employeeName: str('employeeName').toUpperCase(),
    personalEmail: str('personalEmail').toLowerCase(),
    dateOfFiling: date('dateOfFiling', 'Date of Filing'),
    effectivity: date('effectivity', 'Date of Effectivity'),
    purpose: str('purpose'),
    otherPurpose: str('otherPurpose'),
    supervisorName: str('supervisorName').toUpperCase(),
    supervisorEmail: str('supervisorEmail').toLowerCase(),
    headName: str('headName').toUpperCase(),
    headEmail: str('headEmail').toLowerCase(),
  };

  if (!data.office) errors.push('Office of Assignment is required.');
  if (!data.positionTitle) errors.push('Position is required.');
  if (!/^\d{1,2}$/.test(data.sg) || +data.sg < 1 || +data.sg > 33) errors.push('Salary Grade must be 1 to 33.');
  if (!/^\d$/.test(data.step) || +data.step < 1 || +data.step > 8) errors.push('Step must be 1 to 8.');
  if (!HRIS_NAME_RE_.test(data.employeeName)) {
    errors.push('Employee name must follow the HRIS format: SURNAME, FIRST NAME M.I. (e.g., DELA CRUZ, JUAN P.)');
  }
  if (!EMAIL_RE_.test(data.personalEmail)) errors.push('A valid personal email address is required.');
  else if (/@dap\.edu\.ph$/i.test(data.personalEmail)) errors.push('Use the employee\'s personal email, not the DAP email.');
  if (PURPOSES.indexOf(data.purpose) < 0) errors.push('Purpose is required.');
  if (data.purpose === 'Other Mode of Separation' && !data.otherPurpose) errors.push('Please specify the Other Mode of Separation.');
  if (data.purpose !== 'Other Mode of Separation') data.otherPurpose = '';
  if (!data.supervisorName) errors.push('Immediate Supervisor name is required.');
  if (!DAP_EMAIL_RE_.test(data.supervisorEmail)) errors.push('Immediate Supervisor email must be a @dap.edu.ph address.');
  if (!data.headName) errors.push('Head of Office name is required.');
  if (!DAP_EMAIL_RE_.test(data.headEmail)) errors.push('Head of Office email must be a @dap.edu.ph address.');
  if (data.dateOfFiling && data.effectivity && data.effectivity < data.dateOfFiling) {
    errors.push('Date of Effectivity cannot be earlier than the Date of Filing.');
  }

  data.position = `${data.positionTitle} / SG-${data.sg} / Step ${data.step}`;
  return { errors, data };
}
