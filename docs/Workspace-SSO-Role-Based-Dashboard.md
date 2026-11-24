# Handoff: Google Workspace sign-in and role-based dashboards (Apps Script)

How the DAP E-Clearance System identifies each user through their DAP Google account and shows each person a
page tailored to their role, without giving anyone edit access to the underlying Sheets or Drive files. Written
so the same pattern can be reused in the **Order of Payment (OP) system**.

Reference implementation (this repo): `appsscript.json`, `WebApp.gs` (`doGet` routing), `Access.gs` (roles),
`PortalApi.gs` (role-aware page + server endpoints), `Portal.html` (role-aware UI).

---

## 1. The idea in one paragraph

The web app is deployed to **run as the owner (host) account** and to be **openable only by people in the DAP
Workspace domain**. Google makes every visitor sign in with their @dap.edu.ph account before the page loads, and
then tells the script who they are (`Session.getActiveUser().getEmail()`). The script looks that email up in a
roles list kept in a Settings/Users sheet and decides **which page to show, which tabs and buttons to render, and
which records to return**. All reads and writes happen as the host account, so users never need access to the
database or the files. Every server function re-checks the role, so hiding a button is never the only protection.

This is not a separate login system: there are no passwords and no tokens to manage. Google Workspace sign-in
*is* the single sign-on.

```
User clicks link ──► Google sign-in (DAP account) ──► doGet(e)
                                                   │
                         Session.getActiveUser() ──┤  email = "juan@dap.edu.ph"
                                                   │
                         roles from Settings/Users ┤  { canFile, canDashboard, isAdmin, … }
                                                   │
                     ┌─────────────────────────────┼──────────────────────────────┐
                     ▼                             ▼                              ▼
              not allowed                   page chosen by role            data filtered to user
         "Access restricted"          (template gets role flags)      (server endpoints re-check)
```

---

## 2. Deployment settings (the part that makes it work)

`appsscript.json`:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "DOMAIN"
}
```

| Setting | Value | Why |
|---|---|---|
| **Execute as** | **Me** (the host/system account) | All Sheets, Drive and Gmail work runs with the host's permissions. Users need **no** file access. |
| **Who has access** | **Anyone within Development Academy of the Philippines** | Google forces a DAP sign-in, and `Session.getActiveUser().getEmail()` returns the visitor's email. |

Why not "Execute as: user accessing the web app"? Then every user would need edit access to the database and the
files, which is exactly what we wanted to avoid. It would also prompt each user to authorize the script.

> **Identity rule:** with *Execute as Me*, the visitor's email is available **only when the visitor is in the same
> Workspace domain as the script owner**. Personal Gmail accounts and anonymous visitors come back as an empty
> string. That is why employees with only a personal Gmail can't use the portal: they get emails instead. It is
> also why the public QR verification page is a **second deployment** with access *Anyone* that only serves a
> page needing no identity.

---

## 3. Reading the user (server side only)

```js
// WebApp.gs
function currentUser_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
}
```

- Always call this **inside each server function**. Never accept the user's email from the browser: anything
  sent from the client can be edited by the user. `Session` cannot be spoofed.
- Lower-case it once, and compare lower-cased emails everywhere.

---

## 4. Roles: one place, plain functions

`Access.gs` holds every role decision. Roles come from comma-separated lists in the **Settings** sheet, plus
data-driven roles (anyone assigned as a signatory):

```js
function isHost_(email)            { return !!email && email === ECL.HOST_EMAIL; }
function canFile_(email)           { return isHost_(email) || settingList_('INTAKE_USERS').indexOf(email) >= 0; }
function isAdmin_(email)           { return isHost_(email) || settingList_('HRMDD_ADMINS').indexOf(email) >= 0; }
function isRspUser_(email)         { return !!email && settingList_('RSP_USERS').indexOf(email) >= 0; }
function canViewDashboard_(email)  { return isAdmin_(email) || isRspUser_(email); }
function isSignatory_(email)       { /* in the Officers directory, or assigned on any clearance */ }
function canUsePortal_(email)      { return canFile_(email) || canViewDashboard_(email) || isSignatory_(email); }

function requirePortalUser_() {               // guard for server endpoints
  const user = currentUser_();
  if (!canUsePortal_(user)) throw new Error('You do not have access to the E-Clearance System.');
  return user;
}
```

Settings lists are parsed by `settingList_()`, which splits on commas, spaces or semicolons and lower-cases.

| Role (E-Clearance) | Source | Sees |
|---|---|---|
| Host | `ECL.HOST_EMAIL` | Everything |
| Intake users | Settings → `INTAKE_USERS` (blank = host only) | New Clearance Request |
| HRMDD admins | Settings → `HRMDD_ADMINS` | All-Clearances dashboard + admin buttons |
| RSP viewers | Settings → `RSP_USERS` | All-Clearances dashboard, view only |
| Signatories | Officers sheet + Signatories sheet (data-driven) | Officer Portal, **own rows only** |
| Everyone else | — | "Access restricted" page |

---

## 5. Routing: one URL, a different landing page per role

```js
// WebApp.gs
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.v || p.verify) return verifyPage_(p);          // public page (second deployment)
  const user = currentUser_();
  if (!user) return messagePage_('…', 'Please sign in with your DAP account.');
  if (!canUsePortal_(user)) return accessDeniedPage_(user);

  // Default landing page depends on the role; ?page= can request another one.
  const page = p.page || (canFile_(user) ? 'intake' : canViewDashboard_(user) ? 'admin' : 'officer');
  if (page === 'officer' || page === 'admin') return officerPortalPage_(user, p);
  if (!canFile_(user)) return accessDeniedPage_(user, 'New requests can only be filed by …');
  return intakePage_(user);
}
```

Deep links work too: email links point to `…/exec?page=officer&ref=ECL-2026-0002`, and the page scrolls to that item.

---

## 6. Tailoring the page: role flags into the HTML template

The server passes **booleans**, not the role list, into the template:

```js
// PortalApi.gs
function officerPortalPage_(user, p) {
  const t = HtmlService.createTemplateFromFile('Portal');
  t.user = user;
  t.isAdmin = isAdmin_(user);
  t.canDashboard = canViewDashboard_(user);
  t.canFile = canFile_(user);
  t.startTab = p.page === 'admin' && t.canDashboard ? 'admin' : 'pending';
  return t.evaluate().setTitle('DAP E-Clearance Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

The template then renders only what the role may use:

```html
<!-- Portal.html -->
<? if (canFile) { ?><a href="<?= intakeUrl ?>">New Clearance Request</a><? } ?>
<? if (canDashboard) { ?><button class="tab" data-tab="admin">All Clearances</button><? } ?>

<script>
  // Safe JSON hand-off to client JS (escape "<" so the data can't close the <script> tag)
  var CFG = <?!= JSON.stringify({ isAdmin: isAdmin, startTab: startTab }).replace(/</g, '\\u003c') ?>;
  // e.g. only admins get Reopen / Revoke buttons:
  if (CFG.isAdmin && c.status === 'COMPLETED') actions += '<button …>Revoke clearance</button>';
</script>
```

Use `<?= ?>` (escaped) for anything shown as text, and `<?!= ?>` only for trusted, already-escaped JSON as above.

---

## 7. Enforce on the server: every endpoint checks again

Buttons are hidden for convenience. **Security lives in the server functions**, because anyone can call
`google.script.run.anyFunction()` from the browser console:

```js
function portalData()            { const user = requirePortalUser_(); /* …return only this user's rows… */ }
function portalAct(ref, row, a)  { return applyAction_(requirePortalUser_(), ref, row, a); } // + assignment check
function adminData()             { if (!canViewDashboard_(currentUser_())) throw new Error('No access'); … }
function adminReopen(ref, row, reason) { const admin = requireAdmin_(); … }
function submitIntake(form)      { if (!canFile_(currentUser_())) throw new Error('Not authorized'); … }
```

Two levels of checks:
1. **Role:** may this person call this function at all? (`requireAdmin_`, `requirePortalUser_`, `canFile_`)
2. **Record:** may this person act on *this* record? E.g. `isAssigned_(row, user)` checks the row's officer or
   alternate email. Data is **filtered on the server** before it is returned. The browser never receives other
   people's records.

```js
function isAssigned_(sig, email) {
  const e = String(email || '').toLowerCase();
  return !!e && (String(sig['Officer Email']).toLowerCase() === e ||
                 String(sig['Alternate Email']).toLowerCase() === e);
}
```

Also: trailing functions with an underscore (`isAdmin_`) are **private**: `google.script.run` cannot call them.
Only functions without `_` are callable from the browser, so keep that list short and guarded.

---

## 8. Lessons learned (pitfalls we actually hit)

| Symptom | Cause | Fix |
|---|---|---|
| User sees **"You need access — Request access: Viewer / Editor"** | The link was the **`/dev`** test URL (only project editors can open it). Code run from the editor gets `/dev` from `ScriptApp.getService().getUrl()` | Store the **`/exec`** URL in Settings (`WEBAPP_URL`) and build every email link from it. `checkConfig()` warns when it is blank or `/dev` |
| Portal errors for some users | The browser is signed in to **several Google accounts** and the DAP one isn't the default (a known Apps Script web app issue) | Tell users to use a private window, or a browser profile signed in only to DAP. A one-line note in every email |
| New features "don't work" for users but work in the editor | The **web app deployment still serves the old version** | Deploy → Manage deployments → ✏️ → *New version* after every update (for **each** deployment) |
| `getActiveUser()` returns `""` | Visitor not in the DAP domain (personal Gmail, anonymous) | Expected: show a "sign in with your DAP account" page; serve public pages from a separate *Anyone* deployment |
| `ReferenceError: X is not defined` at load | Top-level code in one file used a constant from another file; Apps Script runs files' top-level code **in file order** | Top-level code may only use its own file. Compute cross-file values inside functions |
| GitHub Assistant pull fails with `undefined` | Two files with the **same name** (`Portal.gs` + `Portal.html`); Apps Script forbids it | Unique base names for every file (`PortalApi.gs`) |
| Slow page loads as data grows | Each role check re-reads the Settings sheet | Read Settings once per request, or cache with `CacheService` (see §9) |

---

## 9. Reusing this for the Order of Payment system

### 9.1 Recommended: a `Users` sheet instead of comma lists

The OP system will likely have more roles. Instead of one Settings key per role, keep a sheet:

| Email | Roles | Office | Active |
|---|---|---|---|
| juan@dap.edu.ph | REQUESTER | CFG | TRUE |
| ana@dap.edu.ph | BUDGET, APPROVER | FD | TRUE |
| cashier@dap.edu.ph | CASHIER | Treasury | TRUE |

> The roles above are **examples**. Replace them with the OP workflow's actual steps and offices.

```js
// Access.gs (OP system) — one read per request, cached for 5 minutes
function userProfile_(email) {
  const cache = CacheService.getScriptCache();
  const key = 'u:' + email;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const row = readObjects_('Users').find((u) => String(u.Email).toLowerCase() === email && isTrue_(u.Active));
  const profile = row ? {
    email,
    roles: String(row.Roles).toUpperCase().split(/[,\s;]+/).filter(String),
    office: String(row.Office || ''),
  } : { email, roles: [], office: '' };
  cache.put(key, JSON.stringify(profile), 300);
  return profile;
}

function hasRole_(profile, role) { return profile.roles.indexOf(role) >= 0 || profile.roles.indexOf('ADMIN') >= 0; }

function requireRole_(role) {
  const p = userProfile_(currentUser_());
  if (!hasRole_(p, role)) throw new Error(`This action requires the ${role} role.`);
  return p;
}
```

(After editing the Users sheet, changes apply within 5 minutes, or clear the cache with a small admin function.)

### 9.2 Map pages and data scopes per role

Fill this in for the OP system before coding:

| Role | Landing page | Tabs / buttons | Records returned |
|---|---|---|---|
| REQUESTER *(example)* | My Orders of Payment | New OP, My OPs | Only OPs they created, or their office's |
| BUDGET *(example)* | For Budget Review | Approve / Return | OPs at the Budget step |
| CASHIER *(example)* | For Collection | Mark Paid, Upload OR | OPs approved and unpaid |
| ADMIN | All OPs dashboard | Everything + reopen/void | All |

Rules of thumb:
- **Landing page = the first thing that role must do.** Route in `doGet` with the profile, as in §5.
- **One endpoint per action**, each starting with `requireRole_(...)` **and** a record check, e.g. "is this OP at
  the step this role handles?" or "is it from this user's office?".
- **Filter on the server** by role and office before returning lists.
- **Pass booleans** (`canCreate`, `canApprove`, `isAdmin`) to the template, never the raw roles list.

### 9.3 Skeleton

```js
function doGet(e) {
  const user = currentUser_();
  if (!user) return signInPage_();
  const prof = userProfile_(user);
  if (!prof.roles.length) return accessDeniedPage_(user);
  const t = HtmlService.createTemplateFromFile('App');
  t.user = user;
  t.can = {                                   // booleans only
    create: hasRole_(prof, 'REQUESTER'),
    budget: hasRole_(prof, 'BUDGET'),
    cash: hasRole_(prof, 'CASHIER'),
    admin: hasRole_(prof, 'ADMIN'),
  };
  t.startTab = t.can.admin ? 'all' : t.can.budget ? 'budget' : t.can.cash ? 'cash' : 'mine';
  return t.evaluate().setTitle('DAP Order of Payment')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Browser-callable endpoints: guard first, then filter.
function listMyOps()          { const p = requireRole_('REQUESTER'); return ops_().filter((o) => o.createdBy === p.email); }
function listForBudget()      { requireRole_('BUDGET'); return ops_().filter((o) => o.step === 'BUDGET'); }
function approveBudget(opId)  {
  const p = requireRole_('BUDGET');
  return withLock_(() => {
    const op = getOp_(opId);
    if (op.step !== 'BUDGET') throw new Error('This OP is not at the Budget step.');
    // …update, audit_(opId, p.email, 'BUDGET_APPROVED'), notify next role…
  });
}
```

### 9.4 Also reuse

- `LockService` around every write (`withLock_`), so two people can't act on the same record at once.
- An `AuditLog` sheet: timestamp, record, actor email (from `Session`), event, details.
- Branded email links built from the `/exec` URL in Settings, with the "private window" tip.
- `checkConfig()` at the end of setup, to catch a blank or `/dev` URL before users do.

---

## 10. Test checklist (per role)

- [ ] Each role's test account lands on the right page and sees only its tabs and buttons.
- [ ] A DAP account with **no role** sees "Access restricted".
- [ ] A personal Gmail account gets the "sign in with your DAP account" page (or Google's own block).
- [ ] **Bypass test:** in the browser console, as a non-admin, run
      `google.script.run.withFailureHandler(console.log).adminData()`. It must fail.
- [ ] Lists contain only the records that role and office may see (check the network response, not just the screen).
- [ ] Acting on a record at the wrong step, or from the wrong office, is refused by the server.
- [ ] Email links use `/exec`, and work for a user with no access to the Sheets or Drive files.
- [ ] After a code change: new version deployed, and the user sees the change.
