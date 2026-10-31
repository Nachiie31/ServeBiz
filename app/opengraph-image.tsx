import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center",
          padding: 80, background: "linear-gradient(135deg,#0f6b57,#0a4a3d)", color: "white",
        }}
      >
        <div style={{ fontSize: 40, opacity: 0.85, marginBottom: 24 }}>{SITE_NAME}</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>Point of sale and inventory for small businesses</div>
        <div style={{ fontSize: 32, marginTop: 36, opacity: 0.85 }}>Track stock · Sell fast · Accept GCash · Manage branches</div>
      </div>
    ),
    size
  );
}
