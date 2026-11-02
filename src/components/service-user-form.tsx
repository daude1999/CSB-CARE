import { fromDbDate } from "@/lib/london";

interface Su {
  id: string;
  version: number;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: Date | null;
  nhsNumber: string | null;
  gender: string | null;
  areaId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  town: string | null;
  postcode: string | null;
  phone: string | null;
  altPhone?: string | null;
  preferredContactMethod?: string | null;
  accessNotes: string | null;
  carerGenderPreference: string;
  firstLanguage: string | null;
  communicationNeeds: string | null;
  carePreferences: string | null;
  riskLevel: string | null;
  riskSummary: string | null;
}

/** Personal details form for a service user. Sensitive identifiers are shown only to people allowed to edit them. */
export function ServiceUserForm({ action, su, areas, back, sensitive, submit }: { action: (fd: FormData) => Promise<void>; su?: Su; areas: { id: string; name: string }[]; back: string; sensitive: boolean; submit: string }) {
  const t = (name: keyof Su, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label><span className="label">{label}</span><input name={name} defaultValue={su ? String(su[name] ?? "") : ""} className="input" {...extra} /></label>
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      {su ? <><input type="hidden" name="serviceUserId" value={su.id} /><input type="hidden" name="version" value={su.version} /></> : null}
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-2 text-[15px] font-medium text-navy-900">Person</legend>
        {t("firstName", "First name", { required: true })}
        {t("lastName", "Last name", { required: true })}
        {t("preferredName", "Known as")}
        {sensitive ? <label><span className="label">Date of birth</span><input type="date" name="dateOfBirth" defaultValue={su?.dateOfBirth ? fromDbDate(su.dateOfBirth) : ""} className="input" /></label> : null}
        {sensitive ? t("nhsNumber", "NHS number", { inputMode: "numeric" }) : null}
        {t("gender", "Gender")}
        {t("firstLanguage", "First language")}
        <label><span className="label">Area</span><select name="areaId" defaultValue={su?.areaId ?? ""} className="input"><option value="">No area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label><span className="label">Carer preference</span><select name="carerGenderPreference" defaultValue={su?.carerGenderPreference ?? "ANY"} className="input"><option value="ANY">No preference</option><option value="FEMALE">Female carers</option><option value="MALE">Male carers</option></select></label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-2 text-[15px] font-medium text-navy-900">Home</legend>
        {t("addressLine1", "Address")}
        {t("addressLine2", "Address line 2")}
        {t("town", "Town")}
        {t("postcode", "Postcode")}
        {t("phone", "Phone", { type: "tel" })}
        {t("altPhone", "Alternative phone", { type: "tel" })}
        <label><span className="label">Prefers to be contacted by</span><select name="preferredContactMethod" defaultValue={su?.preferredContactMethod ?? ""} className="input"><option value="">Not recorded</option><option value="PHONE">Telephone</option><option value="SMS">Text message</option><option value="EMAIL">Email</option><option value="OTHER">Other (see communication needs)</option></select></label>
        <label className="md:col-span-3"><span className="label">Access notes for carers</span><textarea name="accessNotes" rows={2} defaultValue={su?.accessNotes ?? ""} className="input" /></label>
      </fieldset>
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-2 text-[15px] font-medium text-navy-900">Care</legend>
        <label><span className="label">Overall risk</span><select name="riskLevel" defaultValue={su?.riskLevel ?? ""} className="input"><option value="">Not assessed</option><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
        <label className="md:col-span-2"><span className="label">Risk summary</span><input name="riskSummary" defaultValue={su?.riskSummary ?? ""} className="input" /></label>
        <label className="md:col-span-3"><span className="label">Communication needs</span><textarea name="communicationNeeds" rows={2} defaultValue={su?.communicationNeeds ?? ""} className="input" /></label>
        <label className="md:col-span-3"><span className="label">What matters to them</span><textarea name="carePreferences" rows={2} defaultValue={su?.carePreferences ?? ""} className="input" /></label>
      </fieldset>
      <button className="btn-primary">{submit}</button>
    </form>
  );
}
