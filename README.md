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

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Gmail button spike | Done (superseded by the Officer Portal) |
| 1 | Master DB, template cleanup, branded intake web app, live form copy and sharing | Done |
| 2 | Officer Portal and All-Clearances dashboard, routing II → III → IV → V, notations, employee updates, accountability and hold threads, OB extension, admin reopen | **Ready to test** |
| 3 | Reminders, deemed clearance (Parts II–III), 30-day reminder (the working-day calculator and OB extension are already in Phase 2) | — |
| 4 | PDF export, QR code, verification page | — |

## Setup

Signed in as **comben@dap.edu.ph**, in the Apps Script project:

1. Copy in every file from `src/` (`.gs`, `.html`, and `appsscript.json`, which turns on the **Drive API**
   and **Gmail API** advanced services). **Delete `Phase0_Spike.gs` and `Codes.gs`** from the project if they're still there.
2. comben@ must be able to open the original CS Form No. 7 sheet (`18c6WDzKDde3Ja8WZ0KfpvgcF1skEQ_eaEcWg1dc6SBs`).
3. Run **`setupSystem`** and approve the new Gmail permission. It is safe to re-run: on an existing DB it adds
   the **Employees** sheet, the new columns (Requests: HRIS Number, Update Thread ID, Update Message ID;
   Signatories: Alternate Name, Acted By) and the new setting `WEBAPP_URL`.
4. **Deploy → Manage deployments → Edit → New version** (or a new Web app deployment): Execute as *Me*,
   Who has access *Anyone within Development Academy of the Philippines*.
5. Optional: paste the `/exec` URL into **Settings → WEBAPP_URL** so email links always use it.
6. Fill in **Holidays** (dates of regular and special non-working holidays and work suspensions) for correct due dates.

Pages: `/exec` (intake for RSP users, portal for everyone else), `/exec?page=officer`, `/exec?page=admin`.

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
