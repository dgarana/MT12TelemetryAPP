import React from "react";
import { ChevronDown } from "lucide-react";

export const LANGUAGES = [
  { value: "en", label: "EN", flag: "🇬🇧", name: "English" },
  { value: "es", label: "ES", flag: "🇪🇸", name: "Español" },
  { value: "de", label: "DE", flag: "🇩🇪", name: "Deutsch" },
  { value: "fr", label: "FR", flag: "🇫🇷", name: "Français" },
];

export function LangDropdown({ value, onChange }: { value: string; onChange: (lang: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="lang-dropdown">
      <button className="lang-btn" onClick={() => setOpen((o) => !o)}>
        {LANGUAGES.find((l) => l.value === value)?.name} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="lang-menu">
          {LANGUAGES.map((opt) => (
            <button
              key={opt.value}
              className={`lang-option${opt.value === value ? " active" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              {opt.flag} {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
