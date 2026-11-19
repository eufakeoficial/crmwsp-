import { tenantProfileSchema, type TenantProfile, type UpdateTenantRequest } from "@crmwsp/contracts";
import { request } from "./api";

export const tenantApi = {
  get: (): Promise<TenantProfile> => request("/tenant", { schema: tenantProfileSchema }),
  rename: (body: UpdateTenantRequest): Promise<TenantProfile> =>
    request("/tenant", { method: "PATCH", body, schema: tenantProfileSchema }),
};
