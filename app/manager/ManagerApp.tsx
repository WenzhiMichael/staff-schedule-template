"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LanguagePicker, useLanguage } from "../language";
import { ScheduleExports } from "./ScheduleExports";
import {
  addDays, assignmentCoverage, assignmentKey, availabilityMinutes, availabilitySlot, formatAssignment,
  isStandardAssignment, managerEndOptions, managerTimeOptions, shortDate, standardShiftMinutes, weekdays,
  type AvailabilityMap, type ScheduleAssignment, type ShiftCode,
} from "../schedule-utils";

type ManagerRecord = { employeeId: number; displayName: string; weekStart: string; availability: AvailabilityMap; updatedAt: string | null };
type LinkState = { employeeId: number; hasLink: boolean; linkUpdatedAt: string | null; pinConfigured: boolean };
type ManagerData = {
  weekStart: string; currentWeekStart: string; records: ManagerRecord[]; draftAssignments: ScheduleAssignment[];
  publishedAt: string | null; linkStates: LinkState[]; scheduleVisibility?: ScheduleVisibility; error?: string;
};
type ScheduleVisibility = "full" | "own";
type EditState = ScheduleAssignment & {
  previousShiftCode: ShiftCode;
  displayName: string;
  dayIndex: number;
  availabilityCode?: string;
};

export default function ManagerApp() {
  const { language, setLanguage, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useState<"schedule" | "employees">("schedule");
  const [pin, setPin] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [currentWeekStart, setCurrentWeekStart] = useState("");
  const [records, setRecords] = useState<ManagerRecord[]>([]);
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [linkStates, setLinkStates] = useState<LinkState[]>([]);
  const [generatedLinks, setGeneratedLinks] = useState<Record<number, string>>({});
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [scheduleVisibility, setScheduleVisibility] = useState<ScheduleVisibility>("full");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savingCell, setSavingCell] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const dates = useMemo(() => weekStart ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) : [], [weekStart]);
  const targetWeek = currentWeekStart ? addDays(currentWeekStart, 7) : "";
  const weekPosition = weekStart < currentWeekStart ? "past" : weekStart === currentWeekStart ? "current" : weekStart === targetWeek ? "next" : "future";
  const weekLabel = weekPosition === "past" ? "历史周（可修改）" : weekPosition === "current" ? "本周（可修改）" : weekPosition === "next" ? "正在安排下周" : "未来周（可提前排班）";

  async function loadManager(requestedWeek?: string) {
    try {
      const query = requestedWeek ? `?week=${requestedWeek}` : "";
      const response = await fetch(`/api/manager/availability${query}`, { cache: "no-store" });
      const data = await response.json() as ManagerData;
      if (response.status === 401) { setAuthorized(false); return; }
      if (!response.ok) throw new Error(data.error || "经理排班页面暂时无法打开。");
      setAuthorized(true); setWeekStart(data.weekStart); setCurrentWeekStart(data.currentWeekStart);
      setRecords(data.records); setAssignments(data.draftAssignments);
      setLinkStates(data.linkStates); setPublishedAt(data.publishedAt); setScheduleVisibility(data.scheduleVisibility ?? "full");
      setDraftNames(Object.fromEntries(data.records.map((record) => [record.employeeId, record.displayName])));
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "经理排班页面暂时无法打开。"); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => loadManager(), 0); return () => window.clearTimeout(timer); }, []);

  async function login(event: FormEvent) {
    event.preventDefault(); setError("");
    const response = await fetch("/api/manager/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setError(data.error || "经理登录失败。"); return; }
    setPin(""); setMessage("经理登录成功。"); await loadManager();
  }

  async function logout() { await fetch("/api/manager/logout", { method: "POST" }); setAuthorized(false); setRecords([]); }

  async function saveVisibility(next: ScheduleVisibility) {
    setSavingVisibility(true); setError("");
    const response = await fetch("/api/manager/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scheduleVisibility: next }) });
    const data = await response.json() as { scheduleVisibility?: ScheduleVisibility; error?: string };
    setSavingVisibility(false);
    if (!response.ok || !data.scheduleVisibility) { setError(data.error || "设置暂时无法保存。"); return; }
    setScheduleVisibility(data.scheduleVisibility);
    setMessage(data.scheduleVisibility === "own" ? "员工现在只能看到自己的班次。" : "员工现在可以看到完整班表。");
  }

  async function saveName(employeeId: number) {
    setSavingId(employeeId); setError("");
    const response = await fetch(`/api/manager/employees/${employeeId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: draftNames[employeeId] }) });
    const data = await response.json() as { employee?: { id: number; displayName: string }; error?: string };
    if (!response.ok || !data.employee) { setError(data.error || "姓名暂时无法保存。"); setSavingId(null); return; }
    setRecords((current) => current.map((record) => record.employeeId === employeeId ? { ...record, displayName: data.employee!.displayName } : record));
    setDraftNames((current) => ({ ...current, [employeeId]: data.employee!.displayName }));
    setMessage("员工名称已更新。"); setSavingId(null);
  }

  async function generateLink(employeeId: number) {
    setSavingId(employeeId); setError("");
    const response = await fetch(`/api/manager/employees/${employeeId}/link`, { method: "POST" });
    const data = await response.json() as { link?: string; error?: string };
    if (!response.ok || !data.link) { setError(data.error || "个人链接暂时无法生成。"); setSavingId(null); return; }
    setGeneratedLinks((current) => ({ ...current, [employeeId]: data.link! }));
    setLinkStates((current) => current.map((item) => item.employeeId === employeeId ? { ...item, hasLink: true, pinConfigured: false, linkUpdatedAt: new Date().toISOString() } : item));
    await navigator.clipboard.writeText(data.link);
    setMessage("PIN 设置链接已生成并复制。旧 PIN 和旧登录已经失效。"); setSavingId(null);
  }

  function assignmentFor(shiftDate: string, shiftCode: ShiftCode, employeeId: number) {
    return assignments.find((item) => assignmentKey(item.shiftDate, item.shiftCode, item.employeeId) === assignmentKey(shiftDate, shiftCode, employeeId));
  }

  function normalizedAvailability(code: string | undefined, dayIndex: number, shiftCode: ShiftCode) {
    const range = availabilityMinutes(code);
    const standard = standardShiftMinutes(dayIndex, shiftCode);
    if (!range || !availabilitySlot(code, dayIndex, shiftCode).visible || !code) return standard;
    const opening = dayIndex < 5 ? 660 : 690;
    const fullDay = range.startMinutes === opening && range.endMinutes === 1440;
    if (fullDay) return standard;
    const startMinutes = dayIndex >= 5 && range.startMinutes === 690 ? 690 : Math.ceil(range.startMinutes / 60) * 60;
    const endMinutes = range.endMinutes === 1440 ? 1440 : Math.floor(range.endMinutes / 60) * 60;
    return endMinutes > startMinutes ? { startMinutes, endMinutes } : standard;
  }

  async function saveAssignment(next: ScheduleAssignment, previousShiftCode = next.shiftCode) {
    const key = assignmentKey(next.shiftDate, previousShiftCode, next.employeeId);
    setSavingCell(key); setError("");
    const response = await fetch("/api/manager/schedule", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekStart, ...next, previousShiftCode, assigned: true }),
    });
    const data = await response.json() as { assignment?: ScheduleAssignment; error?: string };
    if (!response.ok || !data.assignment) { setError(data.error || "排班暂时无法保存。"); setSavingCell(""); return false; }
    setAssignments((current) => [...current.filter((item) => {
      const oldKey = assignmentKey(next.shiftDate, previousShiftCode, next.employeeId);
      const newKey = assignmentKey(next.shiftDate, next.shiftCode, next.employeeId);
      const itemKey = assignmentKey(item.shiftDate, item.shiftCode, item.employeeId);
      return itemKey !== oldKey && itemKey !== newKey;
    }), data.assignment!]);
    setMessage("已保存。"); setSavingCell(""); return true;
  }

  async function quickSelect(record: ManagerRecord, shiftDate: string, dayIndex: number, shiftCode: ShiftCode) {
    if (savingCell) return;
    const existing = assignmentFor(shiftDate, shiftCode, record.employeeId);
    if (existing) {
      setEditing({ ...existing, previousShiftCode: shiftCode, displayName: record.displayName, dayIndex, availabilityCode: record.availability[shiftDate] });
      return;
    }
    const range = normalizedAvailability(record.availability[shiftDate], dayIndex, shiftCode);
    await saveAssignment({ shiftDate, shiftCode, employeeId: record.employeeId, ...range });
  }

  async function removeAssignment(item: EditState) {
    setError("");
    const response = await fetch("/api/manager/schedule", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekStart, shiftDate: item.shiftDate, shiftCode: item.shiftCode, previousShiftCode: item.previousShiftCode, employeeId: item.employeeId, assigned: false }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setError(data.error || "班次暂时无法清除。"); return; }
    setAssignments((current) => current.filter((value) => assignmentKey(value.shiftDate, value.shiftCode, value.employeeId) !== assignmentKey(item.shiftDate, item.previousShiftCode, item.employeeId)));
    setEditing(null); setMessage("这个班次已经清除。");
  }

  async function saveEditedAssignment(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (editing.endMinutes <= editing.startMinutes) { setError("结束时间必须晚于开始时间。"); return; }
    if (await saveAssignment(editing, editing.previousShiftCode)) setEditing(null);
  }

  async function publishSchedule() {
    const question = weekPosition === "past" ? "这是历史周。确认发布更正后的班表？" : "确认发布这份班表？员工发布后会看到正式班表。";
    if (!window.confirm(question)) return;
    const response = await fetch("/api/manager/schedule/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekStart }) });
    const data = await response.json() as { publishedAt?: string; error?: string };
    if (!response.ok) { setError(data.error || "班表暂时无法发布。"); return; }
    setPublishedAt(data.publishedAt ?? new Date().toISOString()); setMessage("最终班表已发布，员工现在可以看到完整班表。");
  }

  async function saveFinalSchedule() {
    if (savingSchedule) return;
    setSavingSchedule(true); setError("");
    const response = await fetch("/api/manager/schedule/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ weekStart }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) setError(data.error || "最终班表暂时无法保存。");
    else setMessage("最终班表已保存，员工暂时看不到。");
    setSavingSchedule(false);
  }

  if (loading) return <main className="loading-screen brand-loading"><img src="/schedule-logo.svg" width={180} height={90} alt="Staff Schedule" /><strong>{t("正在打开经理页面", "Opening manager portal")}</strong></main>;
  if (!authorized) return <ManagerLogin pin={pin} setPin={setPin} login={login} error={error} language={language} setLanguage={setLanguage} />;

  const warnings = buildWarnings(records, assignments);
  const filled = records.filter((record) => record.updatedAt).length;
  return (
    <main className="app-shell manager-page">
      <BrandHeader subtitle="MANAGER SCHEDULING" actions={<><LanguagePicker language={language} setLanguage={setLanguage} /><Link className="ghost-action" href="/?home=1">{t("员工页面", "Staff portal")}</Link><button className="ghost-action" onClick={logout}>{t("退出", "Log out")}</button></>} />
      <section className="dashboard-head">
        <div><p className="eyebrow">{t("经理工作台", "MANAGER WORKSPACE")}</p><h1>{t("下周排班，", "Schedule next week,")}<br /><em>{t("一张表完成。", "all in one table.")}</em></h1></div>
        <aside className="week-summary"><span>{weekPosition === "past" ? "HISTORY" : weekPosition === "current" ? "CURRENT WEEK" : weekPosition === "next" ? "NEXT WEEK" : "FUTURE"}</span><strong>{shortDate(weekStart, language)} — {dates[6] && shortDate(dates[6], language)}</strong><p>{filled} / 8 {t("人已提交 · ", "submitted · ")}{publishedAt ? t("已发布", "Published") : t("未发布", "Not published")}</p></aside>
      </section>
      {(message || error) && <Notice error={Boolean(error)} text={error || message} close={() => { setMessage(""); setError(""); }} />}
      <nav className="workspace-tabs" aria-label={t("经理功能", "Manager functions")}><button className={activeTab === "schedule" ? "active" : ""} onClick={() => setActiveTab("schedule")}>{t("下周排班", "Schedule")}</button><button className={activeTab === "employees" ? "active" : ""} onClick={() => setActiveTab("employees")}>{t("员工管理", "Employees")}</button></nav>

      {activeTab === "schedule" ? <>
        <div className="week-navigation"><button onClick={() => loadManager(addDays(weekStart, -7))}>{t("← 上一周", "← Previous week")}</button><strong>{weekLabel}</strong><button onClick={() => loadManager(addDays(weekStart, 7))}>{t("下一周 →", "Next week →")}</button></div>
        <section className="surface schedule-builder">
          <div className="section-heading"><div><p className="step-label">{t("全员排班", "TEAM SCHEDULE")}</p><h2>{t("点击格子选人，选中后可修改时间", "Click a cell to assign; click again to edit time")}</h2></div><div className="legend"><span className="legend-available">{t("浅绿：员工可上", "Light green: available")}</span><span className="legend-selected">{t("深绿：已经安排", "Dark green: scheduled")}</span><span className="legend-conflict">{t("红框：时间冲突", "Red border: outside availability")}</span></div></div>
          <div className="team-table-wrap"><table className="team-table manager-schedule-table"><thead><tr><th rowSpan={2}>Name</th>{dates.map((date, index) => <th key={date} colSpan={2}>{shortDate(date)}<small>{weekdays[index].slice(-1)}</small></th>)}</tr><tr>{dates.flatMap((_, index) => [<th key={`${index}-early`}>{index < 5 ? "11–6" : "11:30–6"}</th>, <th key={`${index}-late`}>6–C</th>])}</tr></thead><tbody>{records.map((record) => <tr key={record.employeeId}><th>{record.displayName}{!record.updatedAt && <small>未交</small>}</th>{dates.flatMap((date, dayIndex) => (["early", "late"] as const).map((shiftCode) => {
            const availability = availabilitySlot(record.availability[date], dayIndex, shiftCode);
            const selected = assignmentFor(date, shiftCode, record.employeeId);
            const conflict = selected ? assignmentCoverage(record.availability[date], selected) !== "full" : false;
            const custom = selected && !isStandardAssignment(selected, dayIndex) ? formatAssignment(selected) : "";
            const key = assignmentKey(date, shiftCode, record.employeeId);
            return <td key={`${date}-${shiftCode}`}><button disabled={Boolean(savingCell)} className={`schedule-cell ${availability.visible ? "is-available" : ""} ${selected ? "is-selected" : ""} ${conflict ? "has-conflict" : ""}`} onClick={() => quickSelect(record, date, dayIndex, shiftCode)} aria-label={`${record.displayName} ${date} ${shiftCode === "early" ? "早班" : "晚班"}${selected ? "，已安排，点击修改" : "，点击安排"}`}><span className="cell-main">{savingCell === key ? "…" : selected ? custom || "✓" : availability.label || (availability.visible ? "+" : "")}</span>{selected && <small>修改</small>}{conflict && <b>!</b>}</button></td>;
          }))}</tr>)}</tbody></table></div>
          <div className="publish-bar"><div><strong>{t("发布前检查", "PRE-PUBLISH CHECK")}</strong><span>{warnings.length ? language === "en" ? `${warnings.length} item${warnings.length === 1 ? "" : "s"} to review` : `${warnings.length} 项需要留意` : t("没有发现冲突", "No conflicts found")}</span><small>{t("保存后员工看不到；发布后员工可以查看。", "Saved drafts stay private; employees see a schedule only after publishing.")}</small></div><div className="schedule-actions"><ScheduleExports records={records} assignments={assignments} weekStart={weekStart} publishedAt={publishedAt} language={language} /><button className="save-schedule" disabled={savingSchedule} onClick={saveFinalSchedule}>{savingSchedule ? t("保存中…", "Saving…") : t("保存最终班表", "Save final schedule")}</button><button disabled={savingSchedule} onClick={publishSchedule}>{publishedAt ? t("重新发布最终班表", "Republish final schedule") : t("发布最终班表", "Publish final schedule")}</button></div></div>
          {warnings.length > 0 && <div className="warning-list">{warnings.map((warning) => <p key={warning}>! {warning}</p>)}</div>}
        </section>
      </> : <EmployeeManager records={records} linkStates={linkStates} generatedLinks={generatedLinks} draftNames={draftNames} savingId={savingId} setDraftNames={setDraftNames} saveName={saveName} generateLink={generateLink} scheduleVisibility={scheduleVisibility} savingVisibility={savingVisibility} saveVisibility={saveVisibility} />}
      <footer className="site-footer"><strong>Staff Schedule · MANAGER</strong></footer>

      {editing && <div className="modal-backdrop"><button type="button" className="modal-scrim" onClick={() => setEditing(null)} aria-label="关闭班次编辑" /><section className="modal shift-editor" role="dialog" aria-modal="true" aria-labelledby="shift-editor-title"><header><div><p className="step-label">修改最终班次</p><h2 id="shift-editor-title">{editing.displayName} · {weekdays[editing.dayIndex]} {shortDate(editing.shiftDate)}</h2></div><button onClick={() => setEditing(null)} aria-label="关闭">×</button></header><div className="availability-reference"><span>员工原始提交</span><strong>{editing.availabilityCode || "没有提交"}</strong></div><form onSubmit={saveEditedAssignment}><fieldset><legend>显示在哪个格子</legend><div className="slot-choice"><button type="button" className={editing.shiftCode === "early" ? "active" : ""} onClick={() => setEditing({ ...editing, shiftCode: "early" })}>早班格</button><button type="button" className={editing.shiftCode === "late" ? "active" : ""} onClick={() => setEditing({ ...editing, shiftCode: "late" })}>晚班格</button></div></fieldset><div className="custom-time-row"><label>开始时间<select value={editing.startMinutes} onChange={(event) => setEditing({ ...editing, startMinutes: Number(event.target.value) })}>{managerTimeOptions(editing.dayIndex).map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}</select></label><span>→</span><label>结束时间<select value={editing.endMinutes} onChange={(event) => setEditing({ ...editing, endMinutes: Number(event.target.value) })}>{managerEndOptions(editing.dayIndex).filter((time) => time.value > editing.startMinutes).map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}</select></label></div><p>特殊时间会直接写在所选格子里。两个格子同时安排时，时间必须连续。</p><footer><button type="button" className="danger-text" onClick={() => removeAssignment(editing)}>清除班次</button><div><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary" type="submit">保存时间</button></div></footer></form></section></div>}
    </main>
  );
}

function BrandHeader({ subtitle, actions }: { subtitle: string; actions: React.ReactNode }) {
  return <header className="brand-header"><Link className="official-brand" href="/?home=1"><img src="/schedule-logo.svg" width={112} height={56} alt="Staff Schedule" /><span>{subtitle}</span></Link><div className="header-actions">{actions}</div></header>;
}

function Notice({ error, text, close }: { error: boolean; text: string; close: () => void }) {
  return <div className={`notice ${error ? "notice-error" : ""}`} role="status"><span>{error ? "!" : "✓"}</span>{text}<button onClick={close} aria-label="关闭提示">×</button></div>;
}

function EmployeeManager(props: {
  records: ManagerRecord[]; linkStates: LinkState[]; generatedLinks: Record<number, string>; draftNames: Record<number, string>; savingId: number | null;
  setDraftNames: React.Dispatch<React.SetStateAction<Record<number, string>>>; saveName: (id: number) => void; generateLink: (id: number) => void;
  scheduleVisibility: ScheduleVisibility; savingVisibility: boolean; saveVisibility: (value: ScheduleVisibility) => void;
}) {
  return <section className="surface employee-admin"><div className="section-heading"><div><p className="step-label">员工管理</p><h2>姓名与个人 PIN</h2><p>员工自己设置四位 PIN；经理只能重置并发送新链接，不能查看员工 PIN。</p></div><span className="count-badge">固定 8 个员工位置</span></div><fieldset className="privacy-setting"><legend>员工能看到的正式班表</legend><div className="slot-choice"><button type="button" className={props.scheduleVisibility === "full" ? "active" : ""} disabled={props.savingVisibility} aria-pressed={props.scheduleVisibility === "full"} onClick={() => props.saveVisibility("full")}>完整班表（含所有人姓名）</button><button type="button" className={props.scheduleVisibility === "own" ? "active" : ""} disabled={props.savingVisibility} aria-pressed={props.scheduleVisibility === "own"} onClick={() => props.saveVisibility("own")}>只看自己的班次</button></div><p>选择“只看自己的班次”后，服务器不会把其他员工的姓名和班次发给员工手机。显示名称可以用昵称或缩写，不必填真实全名。</p></fieldset><div className="manager-name-grid">{props.records.map((record) => { const linkState = props.linkStates.find((item) => item.employeeId === record.employeeId); return <article className="manager-name-card" key={record.employeeId}><div className="employee-number">#{String(record.employeeId).padStart(2, "0")}</div><div className="employee-edit"><label>显示名称<input aria-label={`员工 ${record.employeeId} 姓名`} maxLength={40} value={props.draftNames[record.employeeId] ?? ""} onChange={(event) => props.setDraftNames((current) => ({ ...current, [record.employeeId]: event.target.value }))} /></label><span className={`pin-status ${linkState?.pinConfigured ? "ready" : ""}`}>{linkState?.pinConfigured ? "PIN 已设置" : linkState?.hasLink ? "等待员工设置 PIN" : "尚未生成链接"}</span></div><div className="employee-actions"><button onClick={() => props.saveName(record.employeeId)} disabled={props.savingId === record.employeeId || (props.draftNames[record.employeeId] ?? "").trim() === record.displayName}>保存名称</button><button className="secondary" onClick={() => props.generateLink(record.employeeId)} disabled={props.savingId === record.employeeId}>{linkState?.pinConfigured ? "重置 PIN 并复制链接" : "生成 PIN 设置链接"}</button></div>{props.generatedLinks[record.employeeId] && <input className="generated-link" readOnly value={props.generatedLinks[record.employeeId]} onFocus={(event) => event.currentTarget.select()} aria-label={`${record.displayName} 新 PIN 设置链接`} />}</article>; })}</div></section>;
}

function ManagerLogin({ pin, setPin, login, error, language, setLanguage }: { pin: string; setPin: (value: string) => void; login: (event: FormEvent) => void; error: string; language: "zh" | "en"; setLanguage: (language: "zh" | "en") => void }) {
  const english = language === "en";
  return <main className="auth-shell"><BrandHeader subtitle="MANAGER ACCESS" actions={<><LanguagePicker language={language} setLanguage={setLanguage} /><Link className="ghost-action" href="/">{english ? "Staff portal" : "员工入口"}</Link></>} /><section className="auth-layout"><div className="auth-copy"><p className="eyebrow">{english ? "MANAGER ONLY" : "经理专用"}</p><h1>{english ? "See the time," : "看清时间，"}<br /><em>{english ? "schedule the week." : "排好下一周。"}</em></h1></div><form className="pin-card" autoComplete="off" onSubmit={login}><span className="auth-kicker">MANAGER PIN</span><h2>{english ? "Enter your six-digit manager PIN" : "输入六位经理 PIN"}</h2><input aria-label={english ? "Six-digit manager PIN" : "六位经理 PIN"} autoComplete="new-password" inputMode="numeric" name="manager-pin" pattern="[0-9]{6}" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="••••••" type="password" required /><button disabled={pin.length !== 6}>{english ? "Open manager schedule" : "进入经理排班"}</button>{error && <p className="form-error" role="alert">{error}</p>}</form></section></main>;
}

function buildWarnings(records: ManagerRecord[], assignments: ScheduleAssignment[]) {
  const warnings: string[] = [];
  for (const item of assignments) {
    const record = records.find((value) => value.employeeId === item.employeeId);
    if (record && assignmentCoverage(record.availability[item.shiftDate], item) !== "full") warnings.push(`${record.displayName} 的 ${shortDate(item.shiftDate)} ${item.shiftCode === "early" ? "早班" : "晚班"}超出提交时间（${formatAssignment(item)}）`);
  }
  for (const record of records) if (!record.updatedAt) warnings.push(`${record.displayName} 尚未提交该周时间`);
  return [...new Set(warnings)];
}
