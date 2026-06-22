import { useMemo, useState } from "react";

function countryCodeToTwemojiCodepoint(code: string | null | undefined): string | null {
  const normalized = code?.trim().toUpperCase() ?? "";
  if (normalized.length !== 2 || !/^[A-Z]{2}$/.test(normalized) || normalized === "XX") {
    return null;
  }
  const base = 0x1f1e6;
  return Array.from(normalized)
    .map((char) => (base + char.charCodeAt(0) - 65).toString(16))
    .join("-");
}

export function FlagIcon({
  countryCode,
  fallback,
  className = "mr-1.5 inline h-3.5 w-5 align-[-0.125em]",
}: {
  countryCode: string | null | undefined;
  fallback?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const codepoint = useMemo(() => countryCodeToTwemojiCodepoint(countryCode), [countryCode]);

  if (!codepoint || failed) {
    return fallback ? <span className="mr-1.5">{fallback}</span> : null;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
      src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codepoint}.svg`}
    />
  );
}
