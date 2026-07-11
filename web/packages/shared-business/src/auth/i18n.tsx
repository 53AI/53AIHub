import { createContext, useContext, ReactNode, useState, useCallback } from "react";
import { authMessages } from "./locales";

export type AuthLang = "zh-cn" | "zh-tw" | "en" | "ja";

interface AuthI18nContextValue {
  lang: AuthLang;
  setLang: (lang: AuthLang) => void;
  t: (key: string) => string;
}

const AuthI18nContext = createContext<AuthI18nContextValue>({
  lang: "zh-cn",
  setLang: () => {},
  t: (key: string) => key,
});

const LANG_KEY = "agent-chat-lang";

export function AuthI18nProvider({
  lang: initialLang,
  children,
}: {
  lang?: AuthLang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<AuthLang>(() => {
    const stored = localStorage.getItem(LANG_KEY) as AuthLang | null;
    return stored || initialLang || "zh-cn";
  });

  const setLang = useCallback((newLang: AuthLang) => {
    setLangState(newLang);
    localStorage.setItem(LANG_KEY, newLang);
  }, []);

  const t = useCallback((key: string): string => {
    const messages = authMessages[lang] || authMessages["zh-cn"];
    const parts = key.split(".");
    let result: any = messages;
    for (const part of parts) {
      if (result && typeof result === "object" && part in result) {
        result = result[part];
      } else {
        return key;
      }
    }
    return typeof result === "string" ? result : key;
  }, [lang]);

  return (
    <AuthI18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </AuthI18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(AuthI18nContext);
}
