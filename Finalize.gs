/**
 * Phase 4 — final electronic clearance: QR code, PDF export, filing, sharing and notice.
 *
 * Runs automatically when the last signatory (Part V) certifies. If it fails, the request stays
 * SIGNED ("All signed · PDF pending") and an HRMDD admin can retry from the dashboard.
 *
 * QR target:
 *  - Settings → VERIFY_URL set (public "Anyone" deployment): the QR opens the verification page.
 *  - VERIFY_URL blank: the QR opens the PDF itself (a placeholder file is created first so its link
 *    is known, then its content is replaced with the exported PDF).
 */

/** Free QR image services (only the verification/PDF link is sent). Tried in order. */
const QR_SERVICES = [
  (text) => `https://quickchart.io/qr?size=300&margin=1&ecLevel=M&format=png&text=${encodeURIComponent(text)}`,
  (text) => `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=4&ecc=M&format=png&data=${encodeURIComponent(text)}`,
];
const QR_SIZE_PX = 92;

function finalizeClearance_(ref, actor) {
  const req = getRequest_(ref);
  if (req.Status !== 'SIGNED') throw new Error(`${ref} is ${req.Status}; only fully signed clearances can be finalized.`);

  const ss = SpreadsheetApp.openById(req['Live Form ID']);
  const sheet = ss.getSheetByName(FORM_SHEET);
  const completed = DriveApp.getFolderById(prop_('FOLDER_COMPLETED'));
  const pdfName = `${ref} — ${req['Employee Name (HRIS)']} — CS Form No. 7 (E-Clearance).pdf`;
  const code = verifyCode_(ref);
  const verifyBase = setting_('VERIFY_URL');

  // 1. Decide the QR target. Without a public verification page, point at the PDF itself.
  let pdfFile = null;
  let qrTarget;
  if (verifyBase) {
    qrTarget = `${verifyBase}?verify=${encodeURIComponent(ref)}&k=${code}`;
  } else {
    pdfFile = completed.createFile(Utilities.newBlob(' ', 'application/pdf', pdfName)); // placeholder
    qrTarget = pdfFile.getUrl();
  }

  let pdf;
  try {
    // 2. QR code at the top right (replaces any earlier one).
    sheet.getImages().forEach((img) => { if (img.getAltTextTitle() === 'ECL_QR') img.remove(); });
    const qr = sheet.insertImage(fetchQr_(qrTarget), 14, 1, 40, 2);
    qr.setWidth(QR_SIZE_PX).setHeight(QR_SIZE_PX).setAltTextTitle('ECL_QR')
      .setAltTextDescription(`Scan to verify ${ref}`);
    highlightStage_(ss, 'COMPLETED');
    SpreadsheetApp.flush();

    // 3. Export to PDF and file it.
    pdf = exportPdf_(ss.getId(), pdfName);
    if (pdfFile) {
      Drive.Files.update({ name: pdfName, mimeType: 'application/pdf' }, pdfFile.getId(), pdf, { supportsAllDrives: true });
    } else {
      pdfFile = completed.createFile(pdf);
    }
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    DriveApp.getFileById(req['Live Form ID']).moveTo(completed);
  } catch (err) {
    if (!verifyBase && pdfFile) pdfFile.setTrashed(true); // remove the empty placeholder before a retry
    throw err;
  }

  // 4. Record and notify.
  const now = new Date();
  updateRow_('Requests', req._row, {
    Status: 'COMPLETED', Stage: 'COMPLETED', 'PDF URL': pdfFile.getUrl(), 'PDF ID': pdfFile.getId(),
    'Verify Code': code, 'Finalized At': now,
  });
  Object.assign(req, { Status: 'COMPLETED', 'PDF URL': pdfFile.getUrl(), 'PDF ID': pdfFile.getId(), 'Verify Code': code });
  audit_(ref, actor || 'system', 'FINALIZED', { pdf: pdfFile.getUrl(), qr: verifyBase ? 'verification page' : 'PDF link' });
  notifyFinalized_(req, pdf, verifyBase ? qrTarget : '');
  return pdfFile.getUrl();
}

/** PNG blob of a QR code for `text`, from the first QR service that answers. */
function fetchQr_(text) {
  let lastError = '';
  for (let i = 0; i < QR_SERVICES.length; i++) {
    try {
      const res = UrlFetchApp.fetch(QR_SERVICES[i](text), { muteHttpExceptions: true, followRedirects: true });
      if (res.getResponseCode() === 200 && /image\/png/i.test(String(res.getHeaders()['Content-Type'] || 'image/png'))) {
        return res.getBlob().setName('qr.png').setContentType('image/png');
      }
      lastError = `HTTP ${res.getResponseCode()}`;
    } catch (err) {
      lastError = err.message;
    }
  }
  throw new Error(`Could not generate the QR code (${lastError}).`);
}

/** Exports both sheets (form + instructions) as one PDF. Paper size from Settings → PDF_PAPER_SIZE. */
function exportPdf_(spreadsheetId, name) {
  const size = (setting_('PDF_PAPER_SIZE') || 'A4').toLowerCase();
  const params = {
    format: 'pdf', size, portrait: 'true', fitw: 'true', gridlines: 'false', printtitle: 'false',
    sheetnames: 'false', pagenum: 'UNDEFINED', fzr: 'false', horizontal_alignment: 'CENTER',
    top_margin: '0.4', bottom_margin: '0.4', left_margin: '0.4', right_margin: '0.4',
  };
  const qs = Object.keys(params).map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const res = UrlFetchApp.fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${qs}`, {
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error(`PDF export failed (HTTP ${res.getResponseCode()}).`);
  return res.getBlob().setName(name).setContentType('application/pdf');
}

/** Runs after the last signature; failures leave the request SIGNED for an admin retry. */
function tryFinalize_(ref, actor) {
  try {
    return finalizeClearance_(ref, actor);
  } catch (err) {
    console.error(`Finalize ${ref}: ${err.stack || err}`);
    audit_(ref, actor || 'system', 'FINALIZE_FAILED', String(err.message || err));
    notifyCompleted_(getRequest_(ref));
    return '';
  }
}

/** HRMDD admin: marks a completed clearance as revoked (the verification page then shows REVOKED). */
function revokeClearance_(admin, ref, reason) {
  return withLock_(() => {
    const why = String(reason || '').trim();
    if (why.length < 10) throw new Error('Please state the reason for revoking (at least 10 characters).');
    const req = getRequest_(ref);
    if (req.Status !== 'COMPLETED') throw new Error('Only completed clearances can be revoked.');
    updateRow_('Requests', req._row, { Status: 'REVOKED', 'Revoked At': new Date(), 'Revoke Reason': why });
    audit_(ref, admin, 'REVOKED', why);
    return `${ref} marked as revoked. Its verification page now shows REVOKED.`;
  });
}
