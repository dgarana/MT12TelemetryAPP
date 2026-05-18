import { useEffect, useState } from "react";
import type { FrameState, LayoutItem } from "../../shared/types";
import { WidgetCanvas } from "./WidgetCanvas";

type CapturePayload = {
  layout: Record<string, LayoutItem>;
  state: FrameState;
  timeMs: number;
  width: number;
  height: number;
};

export function CaptureRenderer() {
  const [payload, setPayload] = useState<CapturePayload | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("capture-mode");
    window.mt12Capture = {
      render: async (nextPayload: CapturePayload) => {
        setPayload(nextPayload);
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
        });
      },
    };
    return () => {
      delete window.mt12Capture;
      document.documentElement.classList.remove("capture-mode");
    };
  }, []);

  if (!payload) return <div className="capture-root" />;

  return (
    <div className="capture-root" style={{ width: payload.width, height: payload.height }}>
      <WidgetCanvas
        layout={payload.layout}
        state={payload.state}
        timeMs={payload.timeMs}
        width={payload.width}
        height={payload.height}
        style={{ display: "block", width: payload.width, height: payload.height }}
      />
    </div>
  );
}
