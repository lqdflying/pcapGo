import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { loginWithGitHub } from "../api/client";
import { Github, Languages } from "lucide-react";
import { useLanguageStore, type Language } from "../lib/store";

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文" },
];

export function LoginPage() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const authError = params.get("auth_error");

  // Derive the deep-link target: React Router location.state.from (set by
  // App's protected-route Navigate) or a ?next= query param (set by the 401
  // interceptor or external OAuth redirect). Validate it is relative.
  function getRedirectTarget(): string {
    const fromState = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
    const fromPath = fromState?.pathname
      ? `${fromState.pathname}${fromState.search ?? ""}`
      : null;
    if (fromPath && fromPath.startsWith("/") && !fromPath.startsWith("//")) {
      return fromPath;
    }
    const fromStatePathname = fromState?.pathname;
    if (
      fromStatePathname
      && fromStatePathname.startsWith("/")
      && !fromStatePathname.startsWith("//")
    ) {
      return fromStatePathname;
    }
    const params = new URLSearchParams(location.search);
    const nextParam = params.get("next");
    if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
      return nextParam;
    }
    return "/";
  }

  function handleLogin() {
    const target = getRedirectTarget();
    // Pass the validated relative path to the backend OAuth flow so the
    // GitHub callback can redirect back to the original deep link.
    void loginWithGitHub(target);
  }

  return (
    <div className="flex h-full items-center justify-center bg-panel-bg">
      <div className="w-full max-w-md rounded-2xl border border-panel-border bg-panel-header p-10 text-center shadow-2xl">
        <div className="mb-4 flex justify-end">
          <div className="flex items-center gap-1 rounded-lg border border-panel-border px-1">
            <Languages className="h-3.5 w-3.5 text-panel-muted" />
            <select
              aria-label={t("common.language")}
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              className="bg-transparent py-1 pr-1 text-xs text-panel-text focus:outline-none"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-6 flex justify-center">
          <img
            src="/brand/pcapGo_logo_transparent.png"
            alt="pcapGo logo"
            className="h-24 w-64 object-contain"
          />
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-panel-text">
          pcapGo
        </h1>
        <p className="mb-8 text-sm text-panel-muted">
          {t("login.subtitle")}
        </p>
        <button
          onClick={handleLogin}
          className="inline-flex items-center gap-3 rounded-lg bg-panel-accent px-6 py-3 font-medium text-panel-header transition hover:bg-panel-accent/80"
        >
          <Github className="h-5 w-5" />
          {t("login.signInWithGithub")}
        </button>
        {authError === "not_allowed" && (
          <p className="mt-4 text-sm text-panel-error">
            {t("login.notAuthorized")}
          </p>
        )}
        {authError && authError !== "not_allowed" && (
          <p className="mt-4 text-sm text-panel-error">
            {t("login.authFailed")}
          </p>
        )}
        <p className="mt-6 text-xs text-panel-muted">
          {t("login.accessRestricted")}
        </p>
      </div>
    </div>
  );
}
