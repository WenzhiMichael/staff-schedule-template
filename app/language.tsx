"use client";

import { useEffect, useState } from "react";

export type Language = "zh" | "en";

const STORAGE_KEY = "staff-schedule-language";

export function useLanguage() {
  const [language, setLanguageState] = useState<Language>("zh");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const timer = window.setTimeout(() => {
      if (saved === "en" || saved === "zh") setLanguageState(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => { document.documentElement.lang = language === "en" ? "en" : "zh-CN"; }, [language]);

  function setLanguage(next: Language) {
    setLanguageState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return { language, setLanguage, t: (zh: string, en: string) => language === "en" ? en : zh };
}

export function LanguagePicker({ language, setLanguage }: { language: Language; setLanguage: (language: Language) => void }) {
  return <div className="language-picker" aria-label="Language / 语言"><button className={language === "zh" ? "active" : ""} onClick={() => setLanguage("zh")} aria-pressed={language === "zh"}>中文</button><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")} aria-pressed={language === "en"}>EN</button></div>;
}
