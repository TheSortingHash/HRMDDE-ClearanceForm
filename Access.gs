/**
 * Who may use the web app. Google's deployment setting ("Anyone within DAP") only identifies the
 * user; these checks decide what they can see. Every page and every server call checks them.
 *
 *   Host account (ECL.HOST_EMAIL) ... everything
 *   INTAKE_USERS .................... New Clearance Request (blank = host only)
 *   HRMDD_ADMINS .................... All-Clearances dashboard + reopen / revoke / generate PDF
 *   RSP_USERS ....................... All-Clearances dashboard (view only)
 *   Signatories ..................... Officer Portal (their own rows): anyone in the Officers
 *                                     directory (officer or alternate) or on any clearance
 *                                     (e.g. an Immediate Supervisor / Head of Office)
 *   Everyone else ................... "Access restricted"
 */
function isHost_(email) {
  return !!email && email === ECL.HOST_EMAIL;
}

function canFile_(email) {
  return isHost_(email) || (!!email && settingList_('INTAKE_USERS').indexOf(email) >= 0);
}

function isAdmin_(email) {
  return isHost_(email) || (!!email && settingList_('HRMDD_ADMINS').indexOf(email) >= 0);
}

function isRspUser_(email) {
  return !!email && settingList_('RSP_USERS').indexOf(email) >= 0;
}

function canViewDashboard_(email) {
  return isAdmin_(email) || isRspUser_(email);
}

function isSignatory_(email) {
  if (!email) return false;
  const match = (a, b) => String(a || '').toLowerCase() === email || String(b || '').toLowerCase() === email;
  if (demoEmails_().indexOf(email) >= 0) return true;
  return readObjects_('Officers').some((o) => match(o['Officer Email'], o['Alternate Email'])) ||
    readObjects_('Signatories').some((s) => match(s['Officer Email'], s['Alternate Email']));
}

function canUsePortal_(email) {
  return canFile_(email) || canViewDashboard_(email) || isSignatory_(email);
}

function requirePortalUser_() {
  const user = currentUser_();
  if (!canUsePortal_(user)) throw new Error('You do not have access to the E-Clearance System.');
  return user;
}

function accessDeniedPage_(user, what) {
  return messagePage_('Access Restricted', `
    <p>${what || 'The DAP E-Clearance System is limited to clearing-office signatories and HRMDD staff.'}</p>
    <p>You are signed in as <b>${escapeHtml_(user || 'an unknown account')}</b>. If you believe you need access,
    please contact HRMDD at clearance@dap.edu.ph.</p>`);
}
