import { describe, expect, it } from "vitest";
import {
  ErrorCode,
  ExternalProviderError,
  NotFoundError,
  TenantContextMissingError,
  errorResponseSchema,
  toErrorResponse,
} from "../index.js";

describe("toErrorResponse", () => {
  it("maps AppError without stack or cause", () => {
    const err = new NotFoundError("Contact not found", { details: { id: "1" }, cause: new Error("secret") });
    const res = toErrorResponse(err, "req-1");
    expect(res).toEqual({ code: ErrorCode.NotFound, message: "Contact not found", details: { id: "1" }, requestId: "req-1" });
    expect(res).not.toHaveProperty("stack");
    expect(res).not.toHaveProperty("cause");
    expect(errorResponseSchema.safeParse(res).success).toBe(true);
  });
  it("maps generic Error to INTERNAL_ERROR without leaking message", () => {
    const res = toErrorResponse(new Error("db password is hunter2"));
    expect(res).toEqual({ code: ErrorCode.Internal, message: "Internal server error" });
    expect(JSON.stringify(res)).not.toContain("hunter2");
    expect(res).not.toHaveProperty("stack");
  });
  it("maps non-Error values", () => {
    for (const v of ["boom", 42, null, undefined, { stack: "x" }]) {
      const res = toErrorResponse(v);
      expect(res.code).toBe(ErrorCode.Internal);
      expect(res).not.toHaveProperty("stack");
    }
  });
});

describe("AppError subclasses", () => {
  it("carry status and provider", () => {
    expect(new TenantContextMissingError().httpStatus).toBe(500);
    const e = new ExternalProviderError("stripe");
    expect(e.httpStatus).toBe(502);
    expect(e.provider).toBe("stripe");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("toErrorResponse leak guards", () => {
  it("does not expose cause or provider internals of ExternalProviderError", () => {
    const err = new ExternalProviderError("360dialog", "Upstream failed", { cause: new Error("api key sk-secret") });
    const res = toErrorResponse(err);
    expect(res).toEqual({ code: ErrorCode.ExternalProvider, message: "Upstream failed" });
    expect(JSON.stringify(res)).not.toContain("sk-secret");
    expect(res).not.toHaveProperty("cause");
  });
  it("does not add details/requestId keys when absent", () => {
    const res = toErrorResponse(new NotFoundError());
    expect(Object.keys(res).sort()).toEqual(["code", "message"]);
  });
});
