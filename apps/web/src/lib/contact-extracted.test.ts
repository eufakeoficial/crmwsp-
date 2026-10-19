import { describe, expect, it } from "vitest";
import { extractedRows } from "./contact-extracted";

describe("extractedRows", () => {
  it("shows value and confidence as percentage", () => {
    expect(extractedRows({ ciudad: { value: "Rosario", confidence: 0.874 } })).toEqual([{ key: "ciudad", value: "Rosario", confidence: 87 }]);
  });
  it("tolerates unexpected shapes as plain text", () => {
    const rows = extractedRows({ a: "libre", b: { value: { m2: 40 }, confidence: 7 }, c: null, d: [1, 2], e: { otro: 1 } });
    expect(rows).toEqual([
      { key: "a", value: "libre", confidence: null },
      { key: "b", value: '{"m2":40}', confidence: null },
      { key: "c", value: "—", confidence: null },
      { key: "d", value: "[1,2]", confidence: null },
      { key: "e", value: '{"otro":1}', confidence: null },
    ]);
    expect(extractedRows(null)).toEqual([]);
  });
  it("keeps markup as text (React escapes it)", () => {
    expect(extractedRows({ x: { value: "<img src=x onerror=alert(1)>" } })[0]?.value).toBe("<img src=x onerror=alert(1)>");
  });
});
