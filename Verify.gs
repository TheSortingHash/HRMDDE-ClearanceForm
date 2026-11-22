/**
 * Public verification page opened by the QR code: ?verify=<Ref No>&k=<code>.
 * Serve it from a second deployment whose access is "Anyone" and put its /exec URL in
 * Settings → VERIFY_URL. Shows minimal details only. The code (an HMAC of the reference number)
 * prevents looking up other clearances by guessing reference numbers.
 */
const CODE_ALPHABET_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function verifySecret_() {
  let s = prop_('VERIFY_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    setProp_('VERIFY_SECRET', s);
  }
  return s;
}

/** 10-character code derived from the reference number. */
function verifyCode_(ref) {
  const sig = Utilities.computeHmacSha256Signature(String(ref), verifySecret_());
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < sig.length && out.length < 10; i++) {
    value = ((value << 8) | (sig[i] & 0xff)) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < 10) {
      out += CODE_ALPHABET_[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function verifyPage_(p) {
  const ref = String(p.verify || '').trim().toUpperCase();
  const code = String(p.k || '').trim().toUpperCase();
  let req = null;
  try {
    req = readObjects_('Requests').find((r) => r['Ref No'] === ref);
  } catch (err) {
    req = null;
  }
  const valid = req && code && code === String(req['Verify Code'] || '') &&
    (req.Status === 'COMPLETED' || req.Status === 'REVOKED');

  let body;
  if (!valid) {
    body = `
<div style="text-align:center; padding: 10px 0 20px;">
  <div style="display:inline-block; background:#fdecea; color:#B3261E; font-weight:bold; padding:10px 18px; border-radius:20px;">NOT FOUND</div>
  <p>This clearance could not be verified. Please check that you scanned the QR code on an official
  DAP electronic clearance, or contact the HRMDD at clearance@dap.edu.ph.</p>
</div>`;
  } else {
    const revoked = req.Status === 'REVOKED';
    body = `
<div style="text-align:center; padding: 4px 0 10px;">
  <div style="display:inline-block; background:${revoked ? '#fdecea' : '#e6f4ea'}; color:${revoked ? '#B3261E' : '#1E7B34'};
    font-weight:bold; padding:10px 18px; border-radius:20px; font-size:18px;">
    ${revoked ? '&#10007; REVOKED' : '&#10003; VALID ELECTRONIC CLEARANCE'}</div>
</div>
${detailsTable_([
  ['Reference No.', req['Ref No']],
  ['Employee', req['Employee Name (HRIS)']],
  ['Date of Effectivity', formatLongDate_(req['Date of Effectivity'])],
  ['Clearance completed', formatLongDate_(req['Finalized At'] || req['Completed At'])],
  ['Issued by', 'Development Academy of the Philippines — HRMDD'],
].concat(revoked ? [['Revoked on', formatLongDate_(req['Revoked At'])]] : []))}
${revoked ? '<p style="color:#B3261E;">This clearance has been revoked by the HRMDD and is no longer valid. Please contact clearance@dap.edu.ph.</p>'
    : linkButton_(req['PDF URL'], 'View Clearance PDF')}
<p style="font-size:12px; color:#777; text-align:center;">Issued through the DAP E-Clearance System under
MC-2026-014, <i>Electronic Clearance Processing</i>.</p>`;
  }
  return HtmlService.createHtmlOutput(brandedEmail_('Clearance Verification', body,
    'DAP E-Clearance System · Verification'))
    .setTitle('DAP E-Clearance Verification')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
