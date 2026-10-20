import { ownerModeStatusSchema, type OwnerModeStatus } from "@crmwsp/contracts";
import { request } from "./api";

export const ownerModeApi = {
  status: (): Promise<OwnerModeStatus> => request("/owner-mode", { schema: ownerModeStatusSchema }),
  register: (phoneE164: string): Promise<OwnerModeStatus> =>
    request("/owner-mode/phone", { method: "POST", body: { phoneE164 }, schema: ownerModeStatusSchema }),
  verify: (code: string): Promise<OwnerModeStatus> =>
    request("/owner-mode/phone/verify", { method: "POST", body: { code }, schema: ownerModeStatusSchema }),
  unlink: (): Promise<OwnerModeStatus> => request("/owner-mode/phone", { method: "DELETE", schema: ownerModeStatusSchema }),
};
