/**
 * Web app entry point (one deployment, several pages).
 * Deploy as: Execute as "Me (comben@dap.edu.ph)", Who has access "Anyone within DAP".
 * The signed-in DAP account is read from Session.getActiveUser(); nobody but the host account
 * needs edit access to the DB or the forms.
 *
 * Routes:
 *   ?page=intake            New Clearance Request (host account / INTAKE_USERS only).
 *   ?page=officer[&ref=…]   Officer Portal — pending clearances and actions (signatories).
 *   ?page=admin             All-Clearances dashboard (HRMDD_ADMINS, RSP_USERS view-only).
 * Access rules: Access.gs.
 *   ?v=<ref>&k=<code>       Public QR verification page (Verify.gs). Serve it from a second
 *                           deployment with access "Anyone"; set Settings → VERIFY_URL.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.v || p.verify) return verifyPage_(p); // public: works on the "Anyone" deployment
  const user = currentUser_();
  if (!user) {
    return messagePage_('DAP E-Clearance System', `<p>Please open this page while signed in to your DAP
      (@dap.edu.ph) Google account.</p>`);
  }
  if (!canUsePortal_(user)) return accessDeniedPage_(user);
  const page = p.page || (canFile_(user) ? 'intake' : canViewDashboard_(user) ? 'admin' : 'officer');

  if (page === 'officer' || page === 'admin') return officerPortalPage_(user, p);
  if (!canFile_(user)) return accessDeniedPage_(user, 'New clearance requests can only be filed by the HRMDD host account.');
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
  t.employeesJson = JSON.stringify(employeeDirectory_()).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle('DAP E-Clearance — New Clearance')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from Intake.html via google.script.run. */
function submitIntake(form) {
  const user = currentUser_();
  if (!canFile_(user)) throw new Error('You are not authorized to file clearances.');
  const v = validateIntake_(form);
  if (v.errors.length) throw new Error(v.errors.join('\n'));
  return createClearance_(v.data, user);
}

function currentUser_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}


/** Active employees for intake autofill: n = HRIS name, h = HRIS no., e = DAP email, p/o = position/office. */
function employeeDirectory_() {
  return readObjects_('Employees')
    .filter((r) => r['Employee Name (HRIS)'] && (r.Active === true || String(r.Active).toUpperCase() === 'TRUE'))
    .map((r) => ({
      n: String(r['Employee Name (HRIS)']).trim().toUpperCase(),
      h: String(r['HRIS Number']).replace(/\.0$/, '').trim(),
      e: String(r['DAP Email'] || '').trim().toLowerCase(),
      p: String(r.Position || '').trim(),
      o: String(r.Office || '').trim(),
    }))
    .sort((a, b) => a.n.localeCompare(b.n));
}

/* ------------------------------------------------------------------ validation */

const DAP_EMAIL_RE_ = /^[^\s@]+@dap\.edu\.ph$/i;
const EMAIL_RE_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HRIS_NAME_RE_ = /^[A-ZÑ][A-ZÑ .'-]*,\s*[A-ZÑ][A-ZÑ .'-]*$/;

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TYPES = /^(application\/pdf|image\/(png|jpeg)|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword)$/;

/** Checks one uploaded file {name, type, data (base64)}; returns it or null. */
function uploadOrNull_(u, label, errors) {
  if (!u || !u.data) return null;
  const bytes = Math.floor(String(u.data).length * 3 / 4);
  if (bytes > UPLOAD_MAX_BYTES) { errors.push(`${label} is larger than 10 MB.`); return null; }
  if (!UPLOAD_TYPES.test(String(u.type || ''))) { errors.push(`${label} must be a PDF, Word document, JPG or PNG.`); return null; }
  return { name: String(u.name || label).slice(0, 120), type: u.type, data: String(u.data) };
}

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
    hrisNumber: str('hrisNumber'),
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
  if (data.hrisNumber && !/^\d{3,10}$/.test(data.hrisNumber)) errors.push('HRIS Number must contain digits only.');
  if (!EMAIL_RE_.test(data.personalEmail)) errors.push('A valid personal email address is required.');
  else if (/@dap\.edu\.ph$/i.test(data.personalEmail)) errors.push('Use the employee\'s personal email, not the DAP email.');
  if (PURPOSES.indexOf(data.purpose) < 0) errors.push('Purpose is required.');
  if (data.purpose === 'Other Mode of Separation' && !data.otherPurpose) errors.push('Please specify the Other Mode of Separation.');
  if (data.purpose !== 'Other Mode of Separation') data.otherPurpose = '';

  // Separation documents: the clearance cannot be initiated without the approved Notice of Separation;
  // CS Form No. 10 (Acceptance of Resignation) is required for resignations.
  data.nos = uploadOrNull_(f && f.nos, 'Notice of Separation', errors);
  data.csf10 = uploadOrNull_(f && f.csf10, 'CS Form No. 10', errors);
  if (!data.nos) errors.push('Please upload the approved Notice of Separation.');
  if (data.purpose === 'Resignation' && !data.csf10) errors.push('Please upload CS Form No. 10 (Acceptance of Resignation).');
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
