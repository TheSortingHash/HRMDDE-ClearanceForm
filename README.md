# DAP E-Clearance System (Prototype)

Electronic processing of CS Form No. 7 (Clearance Form) for plantilla personnel under
**MC-2026-014, Electronic Clearance Processing**. Built entirely on Google Workspace and
Google Apps Script, running under the host account **comben@dap.edu.ph** for the prototype.

## How officers act: the Officer Portal

Signatories get a branded email with the employee's details (name, position, office, purpose,
effectivity, due date) and an **Open in E-Clearance Portal** link. The portal is a page of the same
Apps Script web app, deployed as *Execute as: Me (comben@dap.edu.ph)* and *Who has access: Anyone
within DAP*:

- Google identifies the signed-in DAP account (`Session.getActiveUser()`), so no separate login is needed.
- Officers get **no** edit access to the database or the forms. Only the host account writes.
- An officer sees and acts only on rows assigned to their email or their designated alternate.

The portal has three tabs:

| Tab | Who | What |
|---|---|---|
| Pending My Action | every signatory | Their rows that are due, grouped by employee, with the deadline and working days left, and action buttons. Not Cleared, Hold and pending-case actions require at least 25 characters of specific details. |
| Recently Acted | every signatory | Their last 50 actions, with links to the live forms. |
| All Clearances | `HRMDD_ADMINS` | Every clearance sorted alphabetically, with search, progress, and links to the live form, PDF, folders, template and DB. Click a row to see each signatory, and **Reopen** a row with a stated reason. |

Rules enforced on the server:
- A row can only be acted on by its officer or their alternate, once its step is current, and only while every earlier step is done.
- Cleared, No Pending Case and Certify are final. Only an HRMDD admin can reopen them.
- Reopening a row removes its notation, gives it a new 3-working-day deadline, sends later steps that were emailed but not acted on back to waiting, and notifies the officer and employee.
- Notations read `Electronically signed by NAME · 23 Nov 2026, 10:14 AM`, and say "(alternate)" when an alternate signs.

## Emails

| Email | To | Cc | Thread |
|---|---|---|---|
| Clearance filed, each signature, reopen, all signed | Employee (personal email) | Immediate Supervisor (+ clearance@) | **One "Clearance updates" thread per clearance** |
| Action needed (with portal link) | Signatory, one email listing all their rows | Alternates (+ clearance@) | One per routing step |
| Not Cleared / pending case / investigation | Employee | Officer, Supervisor (+ clearance@) | Own thread, Reply-To = officer |
| Part V Hold | Employee | EVP, HRMDD admins, Supervisor (+ clearance@) | Own thread, Reply-To = HRMDD |

"(+ clearance@)" means clearance@dap.edu.ph is copied only when `TEST_MODE` is off. The update thread is
kept together using the Gmail API (In-Reply-To/References headers), so it shows as one conversation in every inbox.

## Employee directory (autofill)

The **Employees** sheet in the DB holds the full directory from the E-Payment Hub *Payee_Database*:
`HRIS Number`, `Employee Name (HRIS)`, `DAP Email`, plus optional `Position`, `Office` and `Active`.
On the intake form, the employee, supervisor and head name fields suggest **active** employees as you type.
Picking a name fills the HRIS No. (and the position and office if present) for the employee, and the DAP email
for the supervisor and head. Names not in the list can still be typed.

Loading it, either way:
- **`importEmployees()`** (recommended, repeatable): put the E-Payment Hub spreadsheet ID in
  **Settings → EMPLOYEE_SOURCE_ID** (comben@ needs view access) and run the function. It rewrites the sheet,
  keeping any Position or Office typed by HRMDD and any employees added by hand.
- **One-time CSV:** `Employees_import.csv` was generated with the same rules (git-ignored, never committed).
  In the Employees sheet, use File → Import → Upload → *Replace current sheet*.

Rules: an employee is **Active** only with an @dap.edu.ph email. Rows marked "inactive employee", or with a
non-DAP email, are kept but not suggested. HRIS numbers are stored as text. The employee list is never stored
in this repository.

## Agreed workflow

| Stage | Signatories | Buttons | Deemed clearance |
|---|---|---|---|
| Part II | Immediate Supervisor **then** Head of Office (sequential) | Cleared / Not Cleared / On OB-Leave | Yes: 3 working days, or 7 if on OB/leave |
| Part III | All 8 office rows **in parallel**; officers with several rows get one email with buttons per row | Cleared / Not Cleared / On OB-Leave | Yes: 3 working days, or 7 if on OB/leave |
| Part IV | Internal Affairs / Legal | No Pending Case / With Pending Admin Case / With Ongoing Investigation | No |
| Part V | Acting Executive Vice President | Certify / Hold (remarks go to HRMDD **and** the employee) | No |

- Working days exclude weekends and the dates in the HRMDD-maintained Holidays sheet.
- Reminders: day 2 for Parts II and III. Parts IV and V get a reminder every 2 working days,
  cc clearance@dap.edu.ph.
- Extra reminder to every signatory still pending or Not Cleared **5 days before the 30-day
  deadline** (30 calendar days from the Date of Effectivity, §III.D.3).
- A recorded Cleared, No Pending Case or Certify is final. Only an HRMDD admin action can reopen it.
- There is no "cleared subject to terminal-pay deduction" status. An unsettled accountability stays Not Cleared.
- On completion, the form is exported to PDF with a QR code that links to a verification page
  showing minimal details and the PDF link.
- Intake is a DAP-branded web app used by HRMDD-RSP. Office of Assignment is free text for now.
  The prototype covers plantilla personnel only.

## Daily checks (Phase 3)

`runDailyChecks` runs every day at 7 AM (Asia/Manila). `setupSystem` installs it, and `installTriggers` re-installs it.

| Check | When | What happens |
|---|---|---|
| Deemed clearance (Parts II–III, §III.E) | Any day, once a row is past its due date (3 working days, or 7 if extended) and still not acted on | The row becomes **Deemed Cleared**, with the notation "Deemed cleared (MC-2026-014 §III.E)" on the form. The officer is emailed (cc alternate + clearance@) with the §III.E.4 note that later-found accountabilities are not waived. The employee is told in the update thread, and routing moves on. Not Cleared rows are never deemed. |
| Day-2 reminder (Parts II–III) | Working days, when 1 working day is left | One reminder per officer, listing all their rows. It is sent again if the deadline was extended. |
| Parts IV–V reminder | Working days, every 2 working days while pending | Reminder email (cc clearance@). These Parts are never deemed cleared. |
| 30-day reminder (§III.D.3) | First working day on or after Date of Effectivity + 25 days, once per clearance | A final reminder to every Part II–IV signatory still pending or Not Cleared, and a note to the employee in the update thread listing what is still open. |

**Rows lock at the deadline (11:59 PM of the due date).** As soon as anyone opens the portal or dashboard after a
deadline, overdue rows are deemed cleared and routing moves on. An officer who tries to act on an expired row is
told it has been deemed cleared. The 7 AM run catches anything not yet swept, and sends the reminders.

**Testing without waiting days** (only while `TEST_MODE` is on; each uses the most recent in-progress clearance):
`testReminders` (makes the current rows due for a reminder), `testDeemedClearance` (makes current Part II–III rows
overdue), `testFinalReminder` (moves the Date of Effectivity 25 days back). Each runs the daily checks immediately.
Reminders only go out on working days, so run them on a weekday.

## Final electronic clearance (Phase 4)

When Part V is certified, `finalizeClearance_` runs automatically:
1. A QR code is placed at the top right of the form. It opens the **verification page**
   (`VERIFY_URL?v=REF&k=CODE`, with an 8-character code derived from the reference number, so other
   clearances cannot be looked up by guessing). If **Settings → VERIFY_URL** is blank, the QR opens the PDF itself.
2. The form (both sheets) is exported to PDF (**Settings → PDF_PAPER_SIZE**: `oficio` = 8.5" × 13" by default,
   or `legal` or `A4`), saved in
   *Completed Clearances* and shared as *anyone with the link can view*. The live form moves to that folder too.
3. The request becomes **COMPLETED**, and the employee gets the PDF **attached** in their update thread (cc Supervisor).

The verification page shows only: the VALID or REVOKED status, Ref No., employee name, Date of Effectivity,
completion date and a *View PDF* button.

**QR code:** generated inside the script by `QrCode.gs`, with no outside service. To keep it easy to scan, it uses the
smallest QR version that fits, keeping error-correction level M (15%) unless level L (7%) gives a smaller code.
It is printed at about 3.4 cm. A verification link (about 140 characters) becomes a 45 × 45 version-7 code, and a
direct PDF link a 33 × 33 version-4 code. The encoder was checked against the reference `qrcode` library (all test
matrices and PNGs identical, versions 1–20, levels L and M) and decoded with zxing-cpp (34/34).
If finalization fails, the request stays **All signed · PDF pending**, and the dashboard shows a
**Generate final PDF** button. Admins can also **Revoke** a completed clearance (with a reason), after which the
verification page shows REVOKED.

**Testing:** file a clearance, run `testFastForwardToEVP` (clears Parts II–IV as TEST), then certify as the EVP
(anchetam@) in the portal.

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Gmail button spike | Done (superseded by the Officer Portal) |
| 1 | Master DB, template cleanup, branded intake web app, live form copy and sharing | Done |
| 2 | Officer Portal and All-Clearances dashboard, routing II → III → IV → V, notations, employee updates, accountability and hold threads, OB extension, admin reopen | Done |
| 3 | Daily checks: reminders, deemed clearance (Parts II–III), 30-day reminder | Done (`release-02`) |
| 4 | Final PDF with QR, verification page, revoke | **Ready to test** (`release-04`) |

## Setup (fresh Apps Script project)

All code files sit at the repository root, so each becomes one Apps Script file with the same name.
**Apps Script does not allow two files with the same name** (e.g. `Portal.gs` and `Portal.html`). If it
happens, the GitHub Assistant pull fails with `[github assistant] undefined`. That is why the portal's server
code is `PortalApi.gs`.

Signed in as **comben@dap.edu.ph**:

1. Turn on the **Google Apps Script API** at <https://script.google.com/home/usersettings> (the GitHub Assistant needs it).
2. Create a new project at <https://script.google.com> → New project, and name it e.g. *DAP E-Clearance System*.
3. In the GitHub Assistant bar, pick repository **TheSortingHash/HRMDDE-ClearanceForm**, branch
   the newest **release-NN** branch, then **Pull** (the GitHub Assistant fails when re-pulling a branch it has
   already pulled, so each update is published as a new release branch). You should get these `.gs` files:
   `Clearance, Config, Db, Directory, EmailTemplate, Finalize, Notify, PortalApi, QrCode, Scheduler, Setup, Template,
   TestTools, Verify, WebApp, Workflow, WorkingDays`, plus `Intake` and `Portal` (.html) and `appsscript.json`. If the editor still shows the default `Code.gs`, delete it.
4. Project Settings: tick **Show "appsscript.json"**, and check the time zone is *(GMT+08:00) Manila*.
   Under **Services** you should see **Drive API** and **Gmail API**, which are turned on by `appsscript.json`.
5. comben@ must be able to open the original CS Form No. 7 sheet (`18c6WDzKDde3Ja8WZ0KfpvgcF1skEQ_eaEcWg1dc6SBs`).
6. Open `Setup.gs`, select **`setupSystem`**, click Run, and approve the permissions. The log prints the folder, DB and template links.
   - A new project has no saved settings (Script Properties), so this creates a **new DB and template**, starting
     reference numbers at ECL-YYYY-0001. It reuses the existing *DAP E-Clearance System* folder.
     Move any old *DAP E-Clearance DB* and old template copies to the trash to avoid confusion.
   - To keep an old DB instead: before running setup, add Script Properties `DB_ID` (old DB ID),
     `TEMPLATE_ID` (old template ID) and `SEQ_2026` (last reference number used, e.g. `3`).
7. Load the employee directory: either fill **Settings → EMPLOYEE_SOURCE_ID** and run `importEmployees`,
   or import `Employees_import.csv` into the **Employees** sheet (File → Import → Upload → *Replace current sheet*).
8. **Deploy → New deployment → Web app**: Execute as *Me*, Who has access *Anyone within Development Academy
   of the Philippines*. Paste the `/exec` URL into **Settings → WEBAPP_URL**.
9. **Public verification deployment:** Deploy → New deployment → Web app, description *Verify*,
   Execute as *Me*, Who has access **Anyone**. Paste its `/exec` URL into **Settings → VERIFY_URL**.
   (If DAP's admin settings don't offer *Anyone*, leave VERIFY_URL blank and the QR links straight to the PDF.)
   Visitors to this URL who aren't signed in with a DAP account can only see the verification page.
10. Fill in **Holidays** for correct due dates.
11. Check **Triggers** (clock icon) shows `runDailyChecks`, daily at 7–8 AM.

Updating an existing project: pull the new release branch, then run `setupSystem` once. It adds any new
DB columns and settings and re-installs the trigger, without touching your data.

Pages: `/exec` (intake for RSP users, portal for everyone else), `/exec?page=officer`, `/exec?page=admin`.

If a pull ever fails again, the quickest check is for duplicate names: no two files may share a name
regardless of extension. Manual fallback: create each file in the editor with the name above and paste its
contents, then `appsscript.json` last.

### Phase 2 test checklist

Use the Phase 1 test clearance, or file a new one. Test officers are Dean and Mariel only:
anchetam@ (III-1a, 2a, 3a, 3b, EVP) and anchetad@ (III-1b, 1c, 2b, 3c, 4a, Legal). Use one of them as
Supervisor and the other as Head of Office.

- [ ] Intake autofill: typing "ANCHETA" suggests both names. Picking one fills the HRIS No., and picking a Supervisor or Head fills their DAP email.
- [ ] Filing starts the **Clearance updates** thread (employee, cc Supervisor) and emails the **Supervisor only** (Action needed, with a portal link). The Head gets nothing yet.
- [ ] Every signature adds a reply to that **same** thread, in both the employee's and the Supervisor's inbox.
- [ ] Officer "Action needed" emails do **not** copy the Supervisor.
- [ ] The portal link opens straight to that clearance, with your DAP account detected and no file access requested.
- [ ] Not Cleared with fewer than 25 characters is blocked. With details, the employee gets the thread, Reply-To is the officer, and A21 shows ☑ not cleared.
- [ ] The Supervisor clears: the name cell on the form shows the notation, the employee gets an update, and the Head is emailed next.
- [ ] Head: "On OB / Leave" extends the due date to 7 working days and can only be used once.
- [ ] The Head clears: Part II turns green, Part III turns gold, and all 9 offices are emailed at once (anchetad@ gets **one** email listing 3 rows).
- [ ] Part III ticks ✔ in the Cleared or Not Cleared column with a notation in the signature column. Clicking again on a cleared row is refused.
- [ ] Legal: Ongoing Investigation ticks ☑ on that line. No Pending Case then unticks it and ticks Cleared.
- [ ] EVP: Hold emails the employee and HRMDD. Certify writes the notation above the EVP name. The employee gets "All signatures complete".
- [ ] All Clearances (as comben@): alphabetical order, search, progress bar, folder links. Reopen a row and confirm the officer and employee are emailed and that Part V waits.
- [ ] Someone who isn't assigned sees nothing in Pending, and a direct action attempt is refused.

Template changes: if you change the cleanup code, run `rebuildTemplate`. Layout tweaks made by hand in
the template are kept by later copies. Just don't delete its named ranges (Data → Named ranges).
