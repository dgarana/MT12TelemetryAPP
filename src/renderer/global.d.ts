import type { FrameState, LayoutItem, OverlayApi, UpdaterApi } from "../shared/types";

type CapturePayload = {
  layout: Record<string, LayoutItem>;
  state: FrameState;
  timeMs: number;
  width: number;
  height: number;
};

declare global {
  interface Window {
    overlayApi: OverlayApi;
    updaterApi: UpdaterApi;
    mt12Capture?: {
      render: (payload: CapturePayload) => Promise<void>;
    };
  }
}

export {};
