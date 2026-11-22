/**
 * Action codes and the machine-readable command block carried by every button email.
 *
 * A code is an HMAC of (reference no. | row id | officer email) using a secret kept in
 * Script Properties, so it cannot be guessed and needs no storage to verify.
 */

const CODE_ALPHABET_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
const BLOCK_START_ = '----- E-CLEARANCE CODE (do not edit below this line) -----';
const BLOCK_END_ = '-----------------------------------------------------------';

function getSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('ECL_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('ECL_SECRET', secret);
  }
  return secret;
}

function makeCode_(ref, rowId, officerEmail) {
  const sig = Utilities.computeHmacSha256Signature(
    [ref, rowId, String(officerEmail).toLowerCase()].join('|'), getSecret_());
  // First 5 bytes (40 bits) -> 8 base32 characters.
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < 5; i++) {
    value = (value << 8) | (sig[i] & 0xff);
    bits += 8;
    while (bits >= 5) {
      out += CODE_ALPHABET_[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function verifyCode_(ref, rowId, officerEmail, code) {
  return !!code && makeCode_(ref, rowId, officerEmail) === String(code).toUpperCase();
}

/**
 * Builds the mailto: link behind one button.
 * Subject format: "ECL-2026-0001 | III-3c | CLEARED | K7F2Q9AB"
 */
function buildMailto_(ref, rowId, action, code) {
  const def = ACTIONS[action];
  const subject = `${ref} | ${rowId} | ${action} | ${code}`;
  let body = '';
  if (def.needsDetails) {
    body += def.prompt + '\n\n\n\n';
  } else {
    body += `Please send this email as is to record: ${def.label.toUpperCase()}.\n\n`;
  }
  body += [
    BLOCK_START_,
    `REF: ${ref}`,
    `ROW: ${rowId}`,
    `ACTION: ${action}`,
    `CODE: ${code}`,
    BLOCK_END_,
  ].join('\n');
  // The '+' in the address is left literal; encodeURIComponent handles subject/body.
  return `mailto:${ECL.ACTION_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Reads a command from an incoming email. The body block is preferred (survives subject
 * edits); the subject is the fallback (survives a mangled body).
 * Returns {ref,rowId,action,code,details,source} or null.
 */
function parseCommand_(subject, plainBody) {
  const body = String(plainBody || '').replace(/\r\n/g, '\n');
  const grab = (re) => { const m = body.match(re); return m ? m[1].trim() : ''; };

  let cmd = null;
  const ref = grab(/^\s*>?\s*REF:\s*(\S+)/m);
  const rowId = grab(/^\s*>?\s*ROW:\s*(\S+)/m);
  const action = grab(/^\s*>?\s*ACTION:\s*([A-Z_]+)/m);
  const code = grab(/^\s*>?\s*CODE:\s*([A-Z0-9]+)/mi);
  if (ref && rowId && action && code) {
    cmd = { ref, rowId, action, code: code.toUpperCase(), source: 'body' };
  } else {
    const m = String(subject || '').match(
      /(ECL-[A-Z0-9]+-\d+)\s*\|\s*((?:II|III|IV|V)-[A-Za-z0-9]+)\s*\|\s*([A-Z_]+)\s*\|\s*([A-Z0-9]{8})/i);
    if (m) cmd = { ref: m[1].toUpperCase(), rowId: m[2], action: m[3].toUpperCase(), code: m[4].toUpperCase(), source: 'subject' };
  }
  if (!cmd) return null;

  // Free-text details = everything typed above the code block, minus the prompt line.
  const cut = body.indexOf('----- E-CLEARANCE CODE');
  let details = (cut >= 0 ? body.slice(0, cut) : '').trim();
  const def = ACTIONS[cmd.action];
  if (def && def.prompt) details = details.replace(def.prompt, '').trim();
  details = details.replace(/^Please send this email as is to record:.*$/m, '').trim();
  cmd.details = details;
  return cmd;
}

/** "Juan Dela Cruz <jdc@dap.edu.ph>" -> "jdc@dap.edu.ph" */
function extractEmail_(fromHeader) {
  const s = String(fromHeader || '');
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
