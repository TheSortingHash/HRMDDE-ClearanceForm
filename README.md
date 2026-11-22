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

> Phase 0 (email buttons that send a pre-filled email) proved that email delivery, codes and DAP
> sender authentication work. Its button flow has been replaced by the portal. `Phase0_Spike.gs` and
> `Codes.gs` remain only until Phase 2 removes them.

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
| 1 | Master DB, template cleanup, branded intake web app, live form copy and sharing | **Ready to test** |
| 2 | Officer Portal, routing II → III → IV → V, notations on the form, employee updates, accountability threads | — |
| 3 | Working-day calculator, reminders, OB extension, deemed clearance, 30-day reminder | — |
| 4 | PDF export, QR code, verification page | — |

## Setup (Phase 1)

Signed in as **comben@dap.edu.ph**, in the Apps Script project:

1. Copy in every file from `src/`, including `Intake.html` and the updated `appsscript.json`.
   This turns on the **Drive API** advanced service and the web app settings.
2. comben@ must be able to open the original CS Form No. 7 sheet
   (`18c6WDzKDde3Ja8WZ0KfpvgcF1skEQ_eaEcWg1dc6SBs`), because setup copies it.
3. Run **`setupSystem`** and approve the permissions. The log prints three links:
   - the folder **DAP E-Clearance System**, with subfolders Template, Live Clearance Forms and Completed Clearances,
   - the **DAP E-Clearance DB** spreadsheet, with the sheets Settings, Requests, Signatories,
     Officers (pre-filled with the test addresses), Holidays and AuditLog,
   - the cleaned-up **template** (CS Form No. 7 with ☐ boxes, named ranges and a Ref. No. slot).
4. **Deploy → New deployment → Web app**: Execute as *Me*, Who has access *Anyone within
   Development Academy of the Philippines*. Open the `/exec` URL.
5. RSP users are listed in **Settings → RSP_USERS**. Anyone else who opens the URL lands on the
   Officer Portal placeholder.

Template changes: if you change the cleanup code, run `rebuildTemplate`. Layout tweaks made by hand
in the template are kept by later copies. Just don't delete its named ranges (Data → Named ranges).

### Phase 1 test checklist

- [ ] The template looks right: ☐ boxes instead of £, signature lines intact, nothing overflowing.
- [ ] Intake: submit with mistakes (DAP email as the personal email, name without a comma, Other purpose with no text). Each is caught.
- [ ] Submit a valid request. The live form appears in *Live Clearance Forms* named `ECL-2026-0001 — NAME — CS Form No. 7`:
  - fields filled (values bold and underlined), purpose box ticked, all 13 signatory names filled,
  - **Part II header highlighted gold**, Ref. No. at the top right.
- [ ] The file is shared **view-only** with the personal email and all signatories, and **no** Drive "shared with you" email is sent.
- [ ] The employee gets the branded "Clearance Filed" email (cc supervisor) with a link that opens the live form.
- [ ] DB: one Requests row, 13 Signatories rows (II-SUP `QUEUED`, others `WAITING`), and an AuditLog `FILED` entry.
- [ ] Submitting again for the same personal email is blocked while the first clearance is open.
- [ ] Opening the web app URL from an account not in RSP_USERS shows the Officer Portal placeholder with that account's email.
