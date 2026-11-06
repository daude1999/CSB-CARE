# UK care-data governance checklist (brief section 4.5)

For the owner of Care Solution Bureau CIC before real service-user records are used in production. These are legal, professional and commercial actions. The software cannot complete them, and having features does not make the platform CQC-registered, DSPT-compliant or clinically validated.

| # | Item | Why | Who | State |
|---|---|---|---|---|
| 1 | ICO registration (data protection fee) for Care Solution Bureau CIC | Required for any organisation processing personal data | Owner | Not confirmed |
| 2 | Data Protection Impact Assessment (DPIA) for the CRM | Large-scale health (special category) data | Owner, with a DPO or adviser | Not started |
| 3 | Record of processing activities (Article 30) | UK GDPR | Owner | Not started |
| 4 | Privacy notices for service users, families and staff | Transparency | Owner | Not started |
| 5 | Lawful basis and Article 9 condition recorded (health and social care) | UK GDPR, DPA 2018 Sch. 1 | Owner | Not started |
| 6 | Data processing agreements with hosting (Vercel, Supabase now; Azure later) and any email or SMS provider | Processor contracts | Owner | Not started |
| 7 | International transfer check (where each provider stores and accesses data) | UK GDPR Chapter V | Owner | Not started |
| 8 | Data Security and Protection Toolkit (DSPT) submission | Expected of CQC-registered care providers handling NHS data | Owner | Not started |
| 9 | Retention schedule (care records, rota, HR, finance) | Needed before any deletion feature is built | Owner, using sector guidance | Not started |
| 10 | Access-control sign-off (who has which role, branch and area) | Least privilege | Registered manager | Not started |
| 11 | Clinical safety review before switching on medication (eMAR) | Medication stays off until signed off | Registered manager and clinical lead | Not started; medication is off |
| 12 | Incident and data-breach procedure (72-hour ICO reporting) | UK GDPR Article 33 | Owner | Not started |
| 13 | Business continuity and restore test | Records must be recoverable | Owner, with PR 4 | Not started |
| 14 | Independent penetration test before go-live | External assurance | Owner (supplier cost) | Not started |
| 15 | Staff confidentiality and IT acceptable-use agreements | Workforce controls | Owner | Not confirmed |
| 16 | Caldicott principles and Caldicott Guardian / IG lead named | Health and care information governance | Owner | Not confirmed |
| 17 | Confirm no real records in GitHub, screenshots or test data | Brief rule 1.4 | Developers | Followed in this programme; Faduma's record exists only in the live database |

The software side (audit log, permissions, encryption, restricted health data) is described in `EVANTIX_SECURITY_AUDIT.md`.
