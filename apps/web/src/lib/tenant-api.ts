import { tenantProfileSchema, type TenantProfile, type UpdateTenantRequest } from "@crmwsp/contracts";
import { request } from "./api";

export const tenantApi = {
  rename: (body: UpdateTenantRequest): Promise<TenantProfile> =>
    request("/tenant", { method: "PATCH", body, schema: tenantProfileSchema }),
};
