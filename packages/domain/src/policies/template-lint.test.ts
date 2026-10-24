import { describe, expect, it } from "vitest";
import { lintTemplate } from "./template-lint.js";

const codes = (r: ReturnType<typeof lintTemplate>) => r.issues.map((i) => `${i.level}:${i.code}`).sort();

describe("lintTemplate", () => {
  it("passes a clean utility template", () => {
    const r = lintTemplate({ category: "utility", body: "Hola {{1}}, tu presupuesto {{2}} está listo para revisar." });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("requires opt-out text in marketing templates (warning)", () => {
    const r = lintTemplate({ category: "marketing", body: "Hola {{1}}, esta semana tenemos novedades para tu hogar." });
    expect(codes(r)).toEqual(["warning:marketing_missing_opt_out"]);
    expect(r.ok).toBe(true);
    const ok = lintTemplate({ category: "marketing", body: "Hola {{1}}, novedades para tu hogar. Responde BAJA para no recibir más." });
    expect(ok.issues).toEqual([]);
  });

  it("flags promotional wording in utility templates", () => {
    const r = lintTemplate({ category: "utility", body: "Tu pedido {{1}} salió. ¡Aprovecha 20% de descuento en tu próxima compra!" });
    expect(codes(r)).toEqual(["warning:promotional_in_utility"]);
  });

  it("errors on prohibited verticals and sensitive data requests", () => {
    expect(codes(lintTemplate({ category: "marketing", body: "Compra criptomonedas hoy. Responde STOP para baja." }))).toEqual(["error:prohibited_content"]);
    expect(codes(lintTemplate({ category: "utility", body: "Envíanos el número de tu tarjeta para confirmar {{1}} ahora." }))).toEqual([
      "error:sensitive_data_request",
    ]);
    expect(lintTemplate({ category: "utility", body: "Envíanos tu CVV para confirmar el pago de hoy." }).ok).toBe(false);
  });

  it("checks variable sanity", () => {
    expect(codes(lintTemplate({ category: "utility", body: "Hola {{1}}, tu cita es el {{3}} a las diez." }))).toEqual(["error:variables_not_sequential"]);
    expect(codes(lintTemplate({ category: "utility", body: "{{1}} tu cita está confirmada para mañana." }))).toEqual(["error:variable_at_edge"]);
    expect(codes(lintTemplate({ category: "utility", body: "Tu cita está confirmada para el día {{1}}{{2}} ok gracias." }))).toEqual([
      "error:adjacent_variables",
    ]);
    expect(codes(lintTemplate({ category: "utility", body: "Hola {{1}}, {{2}}, {{3}} y {{4}} listo." }))).toEqual(["warning:too_many_variables"]);
  });

  it("warns about URL shorteners", () => {
    expect(codes(lintTemplate({ category: "utility", body: "Revisa tu presupuesto {{1}} en https://bit.ly/abc cuando puedas." }))).toEqual([
      "warning:url_shortener",
    ]);
  });

  it("is case and accent insensitive", () => {
    expect(lintTemplate({ category: "utility", body: "Hola {{1}}, ENVIA TU CONTRASENA para entrar a tu cuenta." }).ok).toBe(false);
  });
});
