import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const size = { width: 32, height: 32 };

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          background: "linear-gradient(145deg, #0891b2, #6366f1)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontFamily: "system-ui, sans-serif"
        }}
      >
        SR
      </div>
    ),
    { ...size }
  );
}
