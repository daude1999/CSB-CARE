# Security incident and data breach response

> **DRAFT FOR HUMAN REVIEW.** Drafted on 10 November 2026. It becomes the organisation's procedure only when the
> owner adopts it, fills in the named people and phone numbers marked **[OWNER]**, and staff are told about it.
> Check the reporting routes against the ICO's and NHS England's current guidance before adopting.

## 1. What counts

A **personal data breach** is a security incident that leads to personal data being lost, destroyed, altered,
disclosed or accessed without authority (UK GDPR Article 4(12)). It covers accidents as well as attacks. Examples:

- a carer's phone with the app signed in is lost;
- a support plan is emailed or uploaded to the wrong person or the wrong service user's record;
- a member of staff looks at records they have no reason to see;
- an account is taken over;
- one organisation can see another organisation's records;
- the database or backups are lost, corrupted or encrypted by ransomware;
- real records are pasted into a chat tool, an AI tool, GitHub or a screenshot.

A **near miss** (caught before anyone saw anything) is still recorded.

## 2. Who does what

| Role | Person | Contact |
| --- | --- | --- |
| Incident lead (decides, owns the clock) | **[OWNER]** | |
| Data protection lead / DPO (decides on ICO and individuals) | **[OWNER]** | |
| Caldicott Guardian / registered manager (care impact, safeguarding) | **[OWNER]** | |
| Technical lead (contain, investigate, restore) | **[OWNER]** | |
| Deputy for each of the above | **[OWNER]** | |

Anyone who suspects a breach tells the incident lead **immediately**, by phone, at any hour. Nobody is blamed for
reporting.

## 3. The 72-hour clock

The clock starts when the organisation **becomes aware** that a breach has probably happened, meaning when any
member of staff has reasonable certainty, not when the investigation ends. Weekends and bank holidays count.

| When | What | Who |
| --- | --- | --- |
| **Hour 0** | Write down the time of awareness. Open an incident record (section 8). Call the incident lead. | Whoever finds it |
| **0 to 4 hours** | **Contain** (section 4). Keep evidence. Do not delete anything. | Technical lead |
| **0 to 24 hours** | **Assess** (section 5): what data, whose, how many people, what could happen to them. | Incident lead, data protection lead |
| **By 24 hours** | **Decide** whether the breach is reportable (section 6). Record the decision and the reasons either way. | Data protection lead |
| **By 72 hours** | **Report to the ICO** if reportable, even if facts are still missing; say more will follow. If later than 72 hours, give the reasons for the delay. | Data protection lead |
| **Without undue delay** | **Tell the people affected** if the risk to them is high (section 7). | Incident lead, registered manager |
| **Within 2 weeks** | Review and lessons learned (section 9). | Incident lead |

## 4. Contain

Do what applies, and note the time of each step:

1. **Account taken over or phone lost.** An organisation admin deactivates the member (Administration, Users),
   which signs them out of the organisation at once (`deactivateMember` in `src/server/admin/users.ts`). To let the
   person back in, reactivate them and issue a password reset link; using the link signs out every other session
   of that user. There is no single "sign out everywhere" button without deactivating.
2. **Wrong document on a record.** Mark it sensitive or remove it from the record following the documents procedure;
   note who opened it from the audit log (every preview and download is logged).
3. **Staff snooping.** Remove or reduce the role; export the person's audit log entries before anything else.
4. **Cross-organisation exposure or an application flaw.** The technical lead takes the affected feature or the
   whole site offline (Vercel: pause the deployment or roll back to the last good one). Protecting records comes
   before availability; the registered manager starts the paper contingency for visits.
5. **Leaked secret** (database password, `CSB_REFERENCE_SECRET`, API key, cron secret). Rotate it at the provider and
   in the hosting settings; review access logs for use of the old one. **Do not rotate `CSB_REFERENCE_SECRET`
   without the technical lead**: existing encrypted references cannot be read with a new key unless they are
   re-encrypted first.
6. **Data loss or ransomware.** Stop writes; restore to a separate database from the latest backup
   (`docs/BACKUPS.md`); compare before switching over. The audit log, source versions and approvals are immutable,
   so a restore does not need them reconciled.
7. **Real data in the wrong place** (chat, AI tool, GitHub, screenshot). Delete it there, ask the provider to purge
   it where possible, and treat it as a disclosure to that provider.

**Preserve evidence:** export the relevant `AuditLog` rows, hosting logs (they expire quickly on the current plan)
and database provider logs before they age out.

## 5. Assess

Record for each breach:

- What happened, when, and how it was found.
- Categories of data: care and health records, safeguarding, medication, DBS outcomes, identity documents, contact
  details, key-safe codes, sign-in details.
- Categories and approximate number of people affected (service users, relatives, staff).
- Who received or could see the data, and whether they can be trusted to delete it.
- Likely consequences: physical harm (for example a key-safe code or address of a vulnerable adult), distress,
  discrimination, identity fraud, loss of confidentiality of health information, loss of access to records needed
  for care.
- Whether the data was encrypted or otherwise unintelligible.

## 6. Decide whether to report to the ICO

**Report unless the breach is unlikely to result in a risk to people's rights and freedoms** (UK GDPR Article
33(1)). With health and care records, most real disclosures will be reportable. When in doubt, report.

- If **not** reporting, write down why. Every breach is recorded whether reported or not (Article 33(5)).
- **How to report:**
  - As a care provider using the Data Security and Protection Toolkit, report through the **DSPT incident
    reporting tool** (https://www.dsptoolkit.nhs.uk), which passes qualifying incidents to the ICO and to the
    Department of Health and Social Care. Confirm this route applies to the organisation when registering on the
    toolkit.
  - Otherwise use the ICO's online breach report form (https://ico.org.uk/for-organisations/report-a-breach/) or
    the ICO helpline, 0303 123 1113.
- **What the report must contain** (Article 33(3)):
  1. the nature of the breach, with the categories and approximate numbers of people and records;
  2. the name and contact details of the data protection lead;
  3. the likely consequences;
  4. the measures taken or proposed, including steps to reduce harm.
- Information may be given **in phases** if it is not all available (Article 33(4)). Send what is known by hour 72.

### If CSB is acting as a processor

Where another care provider uses the platform as a customer, that provider is the controller. CSB must tell it
**without undue delay** after becoming aware (Article 33(2)), in practice within 24 hours, and help it report. The
customer, not CSB, reports to the ICO. The processing agreement should name the contact and the timescale.

## 7. Tell the people affected

If the breach is **likely to result in a high risk** to individuals, tell them **without undue delay** (Article
34), in plain language:

- what happened and what data was involved;
- what it could mean for them;
- what has been done and what they can do (for example change a key-safe code, watch for scam calls);
- who to contact.

For service users who lack capacity, tell their attorney, deputy or the person recorded as able to receive updates.
The registered manager decides how each person is told. Record who was told, when and how. If telling people is not
required (for example the data was encrypted), record why.

## 8. Other people who may need to be told

| Who | When | Route |
| --- | --- | --- |
| Local authority safeguarding team | If an adult at risk is or may be harmed | The branch's local safeguarding route (Policy & Compliance, Local & Safeguarding References) |
| CQC | If the incident affects the service's ability to carry on safely, or is otherwise notifiable under the Care Quality Commission (Registration) Regulations 2009, regulation 18 | CQC provider portal. **[OWNER]** registered manager confirms |
| Commissioning council or NHS body | If their contract requires it (most do, often within 24 hours) | Contract manager **[OWNER]** |
| Police / Action Fraud | Crime such as theft, hacking, ransomware | 101 or Action Fraud 0300 123 2040; live cyber attack: Action Fraud's 24/7 line for businesses |
| NCSC | Significant cyber incident | https://report.ncsc.gov.uk |
| Cyber insurer | Before paying for outside help | Policy details **[OWNER]** |
| Processors (hosting, database) | If the cause may be on their side | Their support and security contacts **[OWNER]** |

The platform never sends any of these notifications itself.

## 9. Record and learn

Keep an incident record for every breach and near miss, whether reported or not:

| Field | |
| --- | --- |
| Reference and title | |
| Time of awareness / who noticed | |
| What happened | |
| Data and people affected (categories, numbers) | |
| Containment steps and times | |
| Risk assessment | |
| ICO decision (reported or not), reasons, time, reference number | |
| Individuals told (who, when, how) or reason not | |
| Others notified | |
| Root cause | |
| Actions, owners and due dates | |
| Closed by / date | |

The platform's Root Cause Analysis workspace (Policy & Compliance, CQC Inspection & Evidence) can hold the
investigation, findings and actions; mark it restricted. Do not put more personal data in the record than needed.

Within two weeks: review what happened, fix the cause, add an automated test where the cause was in the software,
update the DPIA, and brief staff. Review this procedure every year and after every incident, and rehearse it once a
year with a made-up scenario.

## 10. Software gaps that would help (not built)

- A "sign out everywhere" action that does not need the member deactivated first.
- Alerts for unusual access (many records opened quickly, sign-ins from new places).
- Longer log retention in a UK or EU log store.
- A one-click export of everything a named user viewed in a date range.
