import React from "react";

export function Field(props: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: string;
  wide?: boolean;
}) {
  const [draft, setDraft] = React.useState(String(props.value ?? ""));
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setDraft(String(props.value ?? ""));
  }, [props.value]);

  function commit() {
    props.onChange(draft);
  }

  return (
    <label className={props.wide ? "field wide-field" : "field"}>
      <span>{props.label}</span>
      <input
        value={draft}
        type={props.type ?? "text"}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { setDraft(String(props.value ?? "")); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </label>
  );
}
