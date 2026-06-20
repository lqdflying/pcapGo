import { useLocation } from "react-router-dom";
import { loginWithGitHub } from "../api/client";
import { Github } from "lucide-react";

export function LoginPage() {
  const location = useLocation();

  // Derive the deep-link target: React Router location.state.from (set by
  // App's protected-route Navigate) or a ?next= query param (set by the 401
  // interceptor or external OAuth redirect). Validate it is relative.
  function getRedirectTarget(): string {
    const fromState = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    if (fromState && fromState.startsWith("/") && !fromState.startsWith("//")) {
      return fromState;
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
        <div className="mb-6 flex justify-center">
          <div className="rounded-xl bg-panel-accent/10 p-3">
            <svg
              className="h-12 w-12 text-panel-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-3-3v6m-7 3h14a1 1 0 001-1V7a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1z"
              />
            </svg>
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-semibold text-panel-text">
          pcapGo
        </h1>
        <p className="mb-8 text-sm text-panel-muted">
          Upload and analyze packet captures with Wireshark-like inspection
          and AI-powered diagnostics.
        </p>
        <button
          onClick={handleLogin}
          className="inline-flex items-center gap-3 rounded-lg bg-panel-accent px-6 py-3 font-medium text-panel-header transition hover:bg-panel-accent/80"
        >
          <Github className="h-5 w-5" />
          Sign in with GitHub
        </button>
        <p className="mt-6 text-xs text-panel-muted">
          No account needed beyond your GitHub profile.
        </p>
      </div>
    </div>
  );
}
