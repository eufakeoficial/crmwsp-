import { expect, test } from "./support";

test.describe("Zona horaria de la empresa", () => {
  test("cambia la zona horaria y la guarda", async ({ page, api }) => {
    await page.emulateMedia({});
    api.on("GET", "/tenant", () => ({ json: { id: "11111111-1111-4111-8111-111111111111", name: "Negocio E2E", timezone: "Europe/Madrid" } }));
    api.on("PATCH", "/tenant", () => ({ json: { id: "11111111-1111-4111-8111-111111111111", name: "Negocio E2E", timezone: "America/Lima" } }));
    await page.goto("/app/settings/company");

    const select = page.getByRole("combobox");
    await expect(select).toHaveValue("Europe/Madrid");
    await expect(page.getByTestId("timezone-preview")).toContainText("Ahora son");

    await select.selectOption("America/Lima");
    await page.getByRole("button", { name: "Guardar zona horaria" }).click();

    await expect(page.getByText("Zona horaria actualizada.")).toBeVisible();
    const sent = api.requests.find((r) => r.method === "PATCH" && r.path === "/tenant");
    expect(sent?.body).toEqual({ timezone: "America/Lima" });
  });
});
