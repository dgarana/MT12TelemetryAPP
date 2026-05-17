import { useEffect, useState } from "react";
import type { FrameState, LayoutItem } from "../../shared/types";
import { itemBounds, itemName } from "../utils";
import { WidgetPreview } from "./WidgetPreview";

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
      <div className="capture-stage">
        {Object.entries(payload.layout ?? {}).map(([id, item]) => (
          <WidgetPreview
            key={id}
            item={item}
            state={payload.state}
            timeMs={payload.timeMs}
            selected={false}
            bounds={itemBounds(item, payload.width, payload.height)}
            frameWidth={payload.width}
            frameHeight={payload.height}
            name={itemName(id, item)}
            showEditorChrome={false}
          />
        ))}
      </div>
    </div>
  );
}
