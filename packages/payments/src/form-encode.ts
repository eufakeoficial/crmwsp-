export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };

const MAX_DEPTH = 8;

function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Encodes nested data as application/x-www-form-urlencoded using Stripe's bracket notation:
 * `{ a: { b: [1, 2] } }` -> `a[b][0]=1&a[b][1]=2`. null/undefined values are omitted;
 * booleans become "true"/"false". Brackets in the structure stay literal, key segments are escaped.
 */
export function encodeForm(data: { [k: string]: FormValue }): string {
  const pairs: string[] = [];
  const walk = (prefix: string, value: FormValue, depth: number): void => {
    if (value === undefined || value === null) return;
    if (depth > MAX_DEPTH) throw new Error("Form value nested too deeply");
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v, depth + 1));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "") throw new Error("Empty form key");
        walk(`${prefix}[${enc(k)}]`, v, depth + 1);
      }
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Non-finite number in form");
      pairs.push(`${prefix}=${enc(String(value))}`);
    } else {
      pairs.push(`${prefix}=${enc(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(data)) {
    if (k === "") throw new Error("Empty form key");
    walk(enc(k), v, 0);
  }
  return pairs.join("&");
}
