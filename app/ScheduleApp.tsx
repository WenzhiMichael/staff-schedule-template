"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { LanguagePicker, useLanguage } from "./language";
import {
  addDays, assignmentKey, customTimes, dayOptions, endTimes, englishWeekdays, formatAssignment, isPreset,
  isStandardAssignment, shortDate, weekdays,
  type AvailabilityMap, type Employee, type ScheduleAssignment,
} from "./schedule-utils";

type PublishedWeek = { weekStart: string; publishedAt: string | null; assignments: ScheduleAssignment[]; employees: Employee[] };
type EmployeeData = {
  employee: Employee;
  record: { availability: AvailabilityMap; updatedAt: string | null };
  weekStart: string;
  currentWeekStart: string;
  publishedSchedules: { current: PublishedWeek; next: PublishedWeek };
  error?: string;
};

export default function ScheduleApp() {
  const { language, setLanguage, t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [activeView, setActiveView] = useState<"availability" | "schedule">("availability");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [published, setPublished] = useState<EmployeeData["publishedSchedules"] | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [customStart, setCustomStart] = useState("11");
  const [customEnd, setCustomEnd] = useState("6");
  const saveQueue = useRef(Promise.resolve());
  const dates = useMemo(() => weekStart ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) : [], [weekStart]);

  async function load() {
    try {
      const response = await fetch("/api/availability", { cache: "no-store" });
      const data = await response.json() as EmployeeData;
      if (response.status === 401) { setAuthorized(false); return; }
      if (!response.ok) throw new Error(data.error || "个人时间暂时无法打开。");
      setAuthorized(true); setEmployee(data.employee); setWeekStart(data.weekStart);
      setAvailability(data.record.availability); setPublished(data.publishedSchedules);
      setStatus(data.record.updatedAt ? "saved" : "idle");
    } catch (caught) {
      setStatus("error"); setMessage(caught instanceof Error ? caught.message : "个人时间暂时无法打开。");
    } finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(load, 0); return () => window.clearTimeout(timer); }, []);

  function save(next: AvailabilityMap) {
    setStatus("saving");
    const payload = { weekStart, availability: next };
    saveQueue.current = saveQueue.current.then(async () => {
      const response = await fetch("/api/availability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as EmployeeData;
      if (!response.ok) throw new Error(data.error || "自动保存失败。");
      setAvailability(data.record.availability); setStatus("saved"); setMessage("下周可上班时间已自动保存。");
    }).catch((caught: Error) => { setStatus("error"); setMessage(caught.message); });
  }

  function updateDay(date: string, code: string | null) {
    const next = { ...availability };
    if (code) next[date] = code; else delete next[date];
    setAvailability(next); save(next);
  }

  function openEditor(index: number) {
    const current = availability[dates[index]];
    if (current && !isPreset(current, index)) {
      const [start, end] = current.split("-"); setCustomStart(start); setCustomEnd(end);
    } else { setCustomStart(index < 5 ? "11" : "11:30"); setCustomEnd("6"); }
    setEditingDay(index);
  }

  function saveCustom(event: FormEvent) {
    event.preventDefault();
    if (editingDay === null) return;
    const start = customTimes(editingDay).find((time) => time.value === customStart)?.minutes ?? 0;
    const end = endTimes(editingDay).find((time) => time.value === customEnd)?.minutes ?? 0;
    if (end <= start) { setMessage("结束时间必须晚于开始时间，C 代表午夜 12 点。"); return; }
    updateDay(dates[editingDay], `${customStart}-${customEnd}`); setEditingDay(null);
  }

  async function logout() {
    await fetch("/api/employee/logout", { method: "POST" });
    setAuthorized(false); setEmployee(null); setPublished(null);
  }

  if (loading) return <main className="loading-screen brand-loading"><img src="/schedule-logo.svg" width={180} height={90} alt="Staff Schedule" /><strong>{t("正在打开 Staff Schedule 班表", "Opening Staff Schedule schedule")}</strong></main>;
  const showStaffHome = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("home") === "1";
  if (showStaffHome || !authorized || !employee) return <AccessPage key={showStaffHome ? "home" : "access"} />;

  return (
    <main className="app-shell employee-page">
      <BrandHeader subtitle="STAFF SCHEDULE" actions={<><LanguagePicker language={language} setLanguage={setLanguage} /><span className="week-pill">{t("每周一更新", "Updates every Monday")}</span><button className="ghost-action" onClick={logout}>{t("退出", "Log out")}</button></>} />
      <section className="dashboard-head employee-head"><div><p className="eyebrow">{t("员工个人页面", "STAFF PORTAL")}</p><h1>{t("你好，", "Hello,")}<br /><em>{employee.displayName}</em></h1></div><aside className="week-summary"><span>NEXT WEEK</span><strong>{shortDate(weekStart, language)} — {dates[6] && shortDate(dates[6], language)}</strong><p>{t("正在收集下周时间", "Collecting next-week availability")}</p></aside></section>
      {message && <Notice error={status === "error"} text={message} close={() => setMessage("")} />}
      <nav className="workspace-tabs employee-tabs" aria-label={t("员工页面", "Staff portal")}><button className={activeView === "availability" ? "active" : ""} onClick={() => setActiveView("availability")}>{t("下周时间", "Next week")}</button><button className={activeView === "schedule" ? "active" : ""} onClick={() => setActiveView("schedule")}>{t("正式班表", "Published schedule")}</button></nav>

      {activeView === "availability" ? <section className="surface availability-surface">
        <div className="section-heading"><div><p className="step-label">{t("下周可上班时间", "NEXT-WEEK AVAILABILITY")}</p><h2>{employee.displayName}{t("，请选择每一天", ", choose each day")}</h2></div><div className={`save-state ${status}`}><i />{status === "saving" ? t("自动保存中…", "Saving…") : status === "saved" ? t("已自动保存", "Saved automatically") : status === "error" ? t("保存失败", "Could not save") : t("修改后自动保存", "Saves automatically")}</div></div>
        <div className="availability-list">{dates.map((date, index) => { const selected = availability[date]; return <article className={`availability-row ${selected ? "has-value" : ""}`} key={date}><header><span>{language === "en" ? englishWeekdays[index] : weekdays[index]}</span><strong>{shortDate(date, language)}</strong>{selected && <em>{selected}</em>}</header><div className="availability-actions">{dayOptions(index, language).map((option) => <button key={option.value} className={selected === option.value ? "selected" : ""} onClick={() => updateDay(date, selected === option.value ? null : option.value)}><span>{option.label}</span><small>{option.hint}</small>{selected === option.value && <b>✓</b>}</button>)}<button className={selected && !isPreset(selected, index) ? "selected custom" : "custom"} onClick={() => openEditor(index)}><span>{t("自定义", "Custom")}</span><small>{selected && !isPreset(selected, index) ? selected : t("选择时间", "Choose time")}</small>{selected && !isPreset(selected, index) && <b>✓</b>}</button>{selected && <button className="clear-choice" onClick={() => updateDay(date, null)}>{t("清空", "Clear")}</button>}</div></article>; })}</div>
        <footer className="privacy-footer"><strong>C = 12:00 AM</strong><span>{t("每天保存一个连续时段 · 其他员工看不到你的选择", "Save one continuous time range each day · Other employees cannot see your choices")}</span></footer>
      </section> : <ScheduleView published={published} employee={employee} language={language} />}

      <footer className="site-footer"><strong>Staff Schedule</strong></footer>
      <nav className="mobile-bottom-nav" aria-label={t("员工手机导航", "Staff mobile navigation")}><button className={activeView === "availability" ? "active" : ""} onClick={() => setActiveView("availability")}><span>＋</span>{t("下周时间", "Next week")}</button><button className={activeView === "schedule" ? "active" : ""} onClick={() => setActiveView("schedule")}><span>▦</span>{t("正式班表", "Schedule")}</button></nav>

      {editingDay !== null && <div className="modal-backdrop"><button type="button" className="modal-scrim" onClick={() => setEditingDay(null)} aria-label="关闭自定义时间窗口" /><section className="modal" role="dialog" aria-modal="true" aria-labelledby="custom-title"><header><div><p className="step-label">自定义时间</p><h2 id="custom-title">{weekdays[editingDay]} · {shortDate(dates[editingDay])}</h2></div><button onClick={() => setEditingDay(null)} aria-label="关闭">×</button></header><form onSubmit={saveCustom}><div className="custom-time-row"><label>开始时间<select value={customStart} onChange={(event) => setCustomStart(event.target.value)}>{customTimes(editingDay).map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}</select></label><span>→</span><label>结束时间<select value={customEnd} onChange={(event) => setCustomEnd(event.target.value)}>{endTimes(editingDay).map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}</select></label></div><p>结束时间必须晚于开始时间；C 代表午夜 12 点。</p><footer><button type="button" onClick={() => setEditingDay(null)}>取消</button><button className="primary" type="submit">保存这个时段</button></footer></form></section></div>}
    </main>
  );
}

function BrandHeader({ subtitle, actions }: { subtitle: string; actions: React.ReactNode }) {
  return <header className="brand-header"><Link className="official-brand" href="/?home=1" onClick={(event) => { event.preventDefault(); window.location.assign("/?home=1"); }}><img src="/schedule-logo.svg" width={112} height={56} alt="Staff Schedule" /><span>{subtitle}</span></Link><div className="header-actions">{actions}</div></header>;
}

function Notice({ error, text, close }: { error: boolean; text: string; close: () => void }) {
  return <div className={`notice ${error ? "notice-error" : ""}`} role="status"><span>{error ? "!" : "✓"}</span>{text}<button onClick={close} aria-label="关闭提示">×</button></div>;
}

function ScheduleView({ published, employee, language }: { published: EmployeeData["publishedSchedules"] | null; employee: Employee; language: "zh" | "en" }) {
  const current = published?.current ?? null;
  const next = published?.next?.publishedAt ? published.next : null;
  return <div className="schedule-view"><MyShiftSummary schedule={current} employee={employee} language={language} label={language === "en" ? "My shifts this week" : "我的本周班次"} /><PublishedSchedule schedule={current} activeEmployeeId={employee.id} language={language} label={language === "en" ? "Full schedule this week" : "本周完整班表"} pending />{next ? <><MyShiftSummary schedule={next} employee={employee} language={language} label={language === "en" ? "My shifts next week" : "我的下周班次"} /><PublishedSchedule schedule={next} activeEmployeeId={employee.id} language={language} label={language === "en" ? "Full schedule next week" : "下周完整班表"} /></> : <section className="surface pending-schedule upcoming-schedule"><div className="section-heading"><div><p className="step-label">{language === "en" ? "NEXT WEEK" : "下周班表"}</p><h2>{language === "en" ? "Next week's schedule is not published yet" : "下周班表还没有出"}</h2></div><span className="count-badge muted">{language === "en" ? "Not published" : "尚未发布"}</span></div></section>}</div>;
}

function MyShiftSummary({ schedule, employee, label, language }: { schedule: PublishedWeek | null; employee: Employee; label: string; language: "zh" | "en" }) {
  if (!schedule?.publishedAt) return null;
  const dates = Array.from({ length: 7 }, (_, index) => addDays(schedule.weekStart, index));
  const shifts = dates.map((date, dayIndex) => {
    const own = schedule.assignments.filter((item) => item.employeeId === employee.id && item.shiftDate === date).sort((a, b) => a.startMinutes - b.startMinutes);
    if (!own.length) return null;
    return { date, dayIndex, startMinutes: own[0].startMinutes, endMinutes: Math.max(...own.map((item) => item.endMinutes)) };
  }).filter(Boolean) as Array<{ date: string; dayIndex: number; startMinutes: number; endMinutes: number }>;
  return <section className="surface my-shifts"><div className="section-heading"><div><p className="step-label">{label}</p><h2>{shifts.length ? language === "en" ? `${shifts.length} working day${shifts.length === 1 ? "" : "s"}` : `${shifts.length} 天有班` : language === "en" ? "No shifts this week" : "这周没有安排班次"}</h2></div><span className="count-badge">{shortDate(schedule.weekStart, language)} — {shortDate(dates[6], language)}</span></div>{shifts.length > 0 && <div className="my-shift-grid">{shifts.map((shift) => <article key={shift.date}><span>{language === "en" ? englishWeekdays[shift.dayIndex] : weekdays[shift.dayIndex]}</span><strong>{shortDate(shift.date, language)}</strong><b>{formatAssignment(shift)}</b></article>)}</div>}</section>;
}

function PublishedSchedule({ schedule, activeEmployeeId, label, pending = false, language }: { schedule: PublishedWeek | null; activeEmployeeId: number; label: string; pending?: boolean; language: "zh" | "en" }) {
  if (!schedule?.publishedAt) return pending ? <section className="surface pending-schedule"><div className="section-heading"><div><p className="step-label">{label}</p><h2>{language === "en" ? "Your manager is scheduling" : "经理正在安排中"}</h2></div><span className="count-badge muted">{language === "en" ? "Not published" : "尚未发布"}</span></div></section> : null;
  const dates = Array.from({ length: 7 }, (_, index) => addDays(schedule.weekStart, index));
  const assignmentFor = (date: string, shiftCode: "early" | "late", employeeId: number) => schedule.assignments.find((item) => assignmentKey(item.shiftDate, item.shiftCode, item.employeeId) === assignmentKey(date, shiftCode, employeeId));
  return <section className="surface published-schedule"><div className="section-heading"><div><p className="step-label">{label}</p><h2>{shortDate(schedule.weekStart, language)} — {shortDate(dates[6], language)}</h2></div><span className="count-badge">{language === "en" ? "Published" : "已发布"}</span></div><div className="team-table-wrap"><table className="team-table published-table"><thead><tr><th rowSpan={2}>Name</th>{dates.map((date, index) => <th key={date} colSpan={2}>{shortDate(date, language)}<small>{(language === "en" ? englishWeekdays[index] : weekdays[index]).slice(0, language === "en" ? 3 : 1)}</small></th>)}</tr><tr>{dates.flatMap((_, index) => [<th key={`${index}-early`}>{index < 5 ? "11–6" : "11:30–6"}</th>, <th key={`${index}-late`}>6–C</th>])}</tr></thead><tbody>{schedule.employees.map((person) => <tr className={person.id === activeEmployeeId ? "my-schedule-row" : ""} key={person.id}><th>{person.displayName}{person.id === activeEmployeeId && <small>{language === "en" ? "me" : "我"}</small>}</th>{dates.flatMap((date, dayIndex) => (["early", "late"] as const).map((shiftCode) => { const assignment = assignmentFor(date, shiftCode, person.id); const custom = assignment && !isStandardAssignment(assignment, dayIndex) ? formatAssignment(assignment) : ""; return <td className={assignment ? "scheduled" : ""} key={`${date}-${shiftCode}`} aria-label={assignment ? `${person.displayName} ${date} ${formatAssignment(assignment)}` : undefined}>{custom}</td>; }))}</tr>)}</tbody></table></div></section>;
}

function AccessPage() {
  const { language, setLanguage, t } = useLanguage();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [setupEmployee, setSetupEmployee] = useState<Employee | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setupMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "1";
  const invalid = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("access") === "invalid";
  useEffect(() => {
    async function loadAccess() {
      if (setupMode) {
        const response = await fetch("/api/employee/setup", { cache: "no-store" });
        const data = await response.json() as { employee?: Employee; error?: string };
        if (response.ok && data.employee) setSetupEmployee(data.employee); else setError(data.error || "设置链接无效。");
        return;
      }
      const response = await fetch("/api/employees", { cache: "no-store" });
      const data = await response.json() as { employees?: Employee[]; error?: string };
      if (response.ok) setEmployees(data.employees ?? []); else setError(data.error || "员工名单暂时无法打开。");
    }
    const timer = window.setTimeout(loadAccess, 0); return () => window.clearTimeout(timer);
  }, [setupMode]);

  async function login(event: FormEvent) {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError("");
    const response = await fetch("/api/employee/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId: selected.id, pin }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setError(data.error || "登录失败。"); setBusy(false); return; }
    window.location.replace("/");
  }

  async function setupPin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const response = await fetch("/api/employee/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin, confirmPin }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setError(data.error || "PIN 暂时无法设置。"); setBusy(false); return; }
    window.location.replace("/");
  }

  return <main className="auth-shell"><BrandHeader subtitle="STAFF ACCESS" actions={<><LanguagePicker language={language} setLanguage={setLanguage} /><Link className="ghost-action" href="/manager">{t("经理入口", "Manager portal")}</Link></>} />{setupMode ? <section className="auth-layout"><div className="auth-copy"><p className="eyebrow">{t("第一次使用／重置 PIN", "FIRST TIME / RESET PIN")}</p><h1>{t("设置你的", "Set your")}<br /><em>{t("四位 PIN。", "four-digit PIN.")}</em></h1><p>{setupEmployee ? t(`你好，${setupEmployee.displayName}。这个 PIN 由你自己记住，经理只能重置，不能查看。`, `Hello, ${setupEmployee.displayName}. Only you know this PIN; a manager can only reset it.`) : t("正在确认你的设置链接。", "Checking your setup link.")}</p></div><form className="pin-card" autoComplete="off" onSubmit={setupPin}><span className="auth-kicker">STAFF PIN</span><h2>{setupEmployee ? t(`${setupEmployee.displayName}，设置 PIN`, `${setupEmployee.displayName}, set your PIN`) : t("等待链接确认", "Checking link")}</h2><label>{t("输入四位数字", "Enter four digits")}<input aria-label={t("设置四位员工 PIN", "Set four-digit staff PIN")} autoComplete="new-password" inputMode="numeric" name="employee-pin-new" pattern="[0-9]{4}" maxLength={4} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" required /></label><label>{t("再输入一次", "Enter it again")}<input aria-label={t("确认四位员工 PIN", "Confirm four-digit staff PIN")} autoComplete="new-password" inputMode="numeric" name="employee-pin-confirm" pattern="[0-9]{4}" maxLength={4} type="password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" required /></label><button disabled={!setupEmployee || pin.length !== 4 || confirmPin.length !== 4 || busy}>{busy ? t("设置中…", "Setting up…") : t("设置并进入我的页面", "Set PIN and open my schedule")}</button>{error && <p className="form-error" role="alert">{error}</p>}<small>{t("链接设置成功后会自动失效。", "This setup link expires after use.")}</small></form></section> : <section className="staff-auth-layout"><div className="auth-copy"><p className="eyebrow">{t("员工入口", "STAFF PORTAL")}</p><h1>{t("选择名字，", "Choose your name,")}<br /><em>{t("进入我的时间表。", "open your schedule.")}</em></h1>{invalid && <p className="form-error">{t("这个设置链接无效或已经使用，请联系经理重新发送。", "This setup link is invalid or has already been used. Ask your manager for a new one.")}</p>}</div>{selected ? <form className="pin-card staff-pin-card" autoComplete="off" onSubmit={login}><button type="button" className="back-choice" onClick={() => { setSelected(null); setPin(""); setError(""); }}>{t("← 重新选择名字", "← Choose a different name")}</button><span className="auth-kicker">EMPLOYEE #{String(selected.id).padStart(2, "0")}</span><h2>{selected.displayName}</h2><label>{t("四位员工 PIN", "Four-digit staff PIN")}<input aria-label={`${selected.displayName} ${t("四位员工 PIN", "four-digit staff PIN")}`} autoComplete="new-password" inputMode="numeric" name={`employee-pin-${selected.id}`} pattern="[0-9]{4}" maxLength={4} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="••••" required /></label><button disabled={pin.length !== 4 || busy}>{busy ? t("登录中…", "Signing in…") : t("进入我的时间表", "Open my schedule")}</button>{error && <p className="form-error" role="alert">{error}</p>}<small>{t("忘记 PIN？请联系经理重新发送设置链接。", "Forgot your PIN? Ask your manager for a new setup link.")}</small></form> : <div className="staff-name-picker">{employees.map((person) => <button key={person.id} onClick={() => { setSelected(person); setPin(""); setError(""); }}><span>#{String(person.id).padStart(2, "0")}</span><strong>{person.displayName}</strong><small>{t("这是我 →", "This is me →")}</small></button>)}{error && <p className="form-error" role="alert">{error}</p>}</div>}</section>}</main>;
}
