# DAP E-Clearance System (Prototype)

Electronic processing of CS Form No. 7 (Clearance Form) for plantilla personnel under
**MC-2026-014, Electronic Clearance Processing**. Built entirely on Google Workspace and
Google Apps Script, running under the host account **comben@dap.edu.ph** for the prototype.

## How officers act: email buttons that send a pre-filled email

Clearing officers act directly from Gmail. Each request email has, per assigned row,
buttons such as **CLEARED / NOT CLEARED / ON OB-LEAVE**. A button opens a pre-filled Gmail
compose to `comben+eclearance@dap.edu.ph` and the officer presses **Send**. Every minute, a
time trigger on the host account:

1. reads new emails sent to the `+eclearance` address,
2. checks that the sender is the assigned officer, that the email passes DAP sender
   authentication, that the HMAC code matches the reference, row and officer, that the action
   is allowed for that Part, and that details are present when required,
3. records the action (later phases: writes the "Electronically signed by …" notation on the
   form),
4. replies in the same thread with a receipt, and for Not Cleared, Hold or a pending case,
   opens a direct thread between the employee and the officer (Reply-To = officer, cc supervisor and
   clearance@dap.edu.ph).

The officer's own Sent folder keeps a copy of every action (MC-2026-014 §III.D.6, §III.F.1).

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
| 0 | Gmail button spike (`src/Phase0_Spike.gs`) | **Ready to test** |
| 1 | Master DB sheets, template cleanup, intake web app, live form copy and sharing | — |
| 2 | Routing II → III → IV → V, notations on the form, employee updates, accountability threads | — |
| 3 | Working-day calculator, reminders, OB extension, deemed clearance, 30-day reminder | — |
| 4 | PDF export, QR code, verification page | — |

## Setup (Phase 0)

Signed in as **comben@dap.edu.ph**:

1. Create a new Apps Script project at <https://script.google.com>.
2. Copy in every file from `src/`. Turn on *Show "appsscript.json"* in Project Settings and
   replace its contents with `src/appsscript.json`. Or, with clasp, copy
   `.clasp.json.example` to `.clasp.json`, set the script ID, and run `clasp push`.
3. Run `spikeSendTestEmails` and approve the permissions. The execution log prints the URL of the
   **E-Clearance Phase 0 Log** sheet.
4. Run `spikeInstallTrigger`.

### Test checklist

Test addresses: anchetad@ (3 Part III rows, which is the multi-row case), anchetam@ (Part II
Supervisor and Part V EVP), fd-omd-gse@ (Part III Financial Services and Part IV Legal).
The test "employee" receiving accountability threads is anchetad@.

- [ ] Gmail **web**: a button opens a compose window inside Gmail with the To, Subject and Body filled in.
- [ ] Gmail **mobile app** (Android/iOS): same.
- [ ] The `+eclearance` address is kept and not altered in the To field.
- [ ] Cleared: a receipt arrives in the same thread within about 1–2 minutes, and a log row shows `RECORDED`.
- [ ] Not Cleared sent **without** details: rejected with a request for details.
- [ ] Not Cleared **with** details: the employee thread arrives, and replying goes to the officer.
- [ ] Clicking Cleared twice on the same row: the second attempt is rejected as already recorded.
- [ ] Forward a request email to someone else who clicks a button: rejected because the sender isn't the assigned officer.
- [ ] Part IV and Part V buttons behave the same way.
- [ ] Note the **Auth-Results** column for internal mail, and whether fd-omd-gse@ is a mailbox or a group.

Afterwards, run `spikeRemoveTriggers`. Run `spikeReset` to clear recorded states before another round.
