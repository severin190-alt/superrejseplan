import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const size = { width: 180, height: 180 };

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 72,
          fontWeight: 700,
          background: "linear-gradient(145deg, #0891b2, #6366f1)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          borderRadius: 36
        }}
      >
        SR
      </div>
    ),
    { ...size }
  );
}
