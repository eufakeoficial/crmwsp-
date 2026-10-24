import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

export const alt = "Vende+ WSP: CRM para WhatsApp con IA para negocios que envían presupuestos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "#ffffff",
          background: "linear-gradient(135deg, #050a3a 0%, #0a1696 55%, #1233d8 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 16, background: "#D4F53C", color: "#050a3a", fontSize: 44, fontWeight: 800 }}>+</div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 88, fontWeight: 800, lineHeight: 1.03, letterSpacing: -3 }}>
            <span>Vende más por WhatsApp</span>
            <span style={{ color: "#D4F53C" }}>.</span>
          </div>
          <div style={{ fontSize: 34, color: "rgba(255,255,255,0.85)", maxWidth: 900 }}>
            CRM con IA para negocios que cotizan: seguimiento, presupuestos y pagos verificados.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, color: "#D4F53C", fontWeight: 700 }}>
          vendemas.chat
        </div>
      </div>
    ),
    size,
  );
}
