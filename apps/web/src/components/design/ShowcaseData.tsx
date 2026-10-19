"use client";

import { FileCheck, Mail } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/lib/hooks/use-toast";
import {
  Button, Alert, CheckBox, CodeInput, DataCell, DataRow, DataTable, Input, Label, Notice, OptionCard, Pagination,
  PhoneField, ReasonDialog, SidePanel, StatusCard, StatusChip, StepBars, SuccessCard, Switch, Toast, UploadTile,
} from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { Row, Section } from "./Section";

const GRID = "32px 1.2fr 1fr 0.8fr 0.8fr";
const ROWS = [
  { id: "P-0042", client: "Cliente Demo A", amount: 3200, status: "Enviada" },
  { id: "P-0041", client: "Cliente Demo B", amount: 1850, status: "Pidió cambios" },
  { id: "P-0040", client: "Empresa Demo C", amount: 920, status: "Vencida" },
  { id: "P-0039", client: "Marta Egüez", amount: 560, status: "Borrador" },
  { id: "P-0038", client: "Cliente Demo D", amount: 4100, status: "Aprobada" },
];

export function ShowcaseData() {
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [on, setOn] = useState(true);
  const [plan, setPlan] = useState("a");
  const [panel, setPanel] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [step, setStep] = useState(2);
  const [file, setFile] = useState(false);
  const { message, show } = useToast();
  const allChecked = selected.length === ROWS.length ? true : selected.length ? "mixed" : false;
  return (
    <>
      <Section title="Tabla con estados">
        <DataTable label="Presupuestos" grid={GRID} columns={[<CheckBox key="all" checked={allChecked} label="Seleccionar todos" onChange={() => setSelected(selected.length === ROWS.length ? [] : ROWS.map((r) => r.id))} />, "Cliente", "Número", "Monto", "Estado"]}>
          {ROWS.map((r) => (
            <DataRow key={r.id} grid={GRID} highlighted={selected.includes(r.id)}>
              <DataCell><CheckBox checked={selected.includes(r.id)} label={`Seleccionar ${r.client}`} onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} /></DataCell>
              <DataCell className="font-bold"><button type="button" onClick={() => setPanel(true)} className="cursor-pointer truncate bg-transparent p-0 text-left font-bold text-ink hover:underline">{r.client}</button></DataCell>
              <DataCell>{r.id}</DataCell>
              <DataCell>{formatMoney(r.amount, "USD")}</DataCell>
              <DataCell><StatusChip label={r.status} /></DataCell>
            </DataRow>
          ))}
        </DataTable>
        <Pagination page={page} pageCount={3} onChange={setPage} summary={`Mostrando ${(page - 1) * 5 + 1}–${page * 5} de 15`} />
      </Section>

      <Section title="Progreso y selección">
        <div className="max-w-md"><p className="mb-2 text-sm font-bold">Paso {step} de 4</p><StepBars total={4} current={step} /><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))}>Atrás</Button><Button size="sm" onClick={() => setStep((s) => Math.min(4, s + 1))}>Siguiente</Button></div></div>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          {[["a", "Plan Inicial", "1 número"], ["b", "Plan Equipo", "3 números"]].map(([id, name, desc]) => (
            <OptionCard key={id} mode="radio" selected={plan === id} onSelect={() => setPlan(id as string)}><b className="block">{name}</b><span className="text-sm text-muted">{desc}</span></OptionCard>
          ))}
        </div>
        <Row label="Switch"><Switch checked={on} onChange={setOn} label="Notificaciones" /><span className="text-sm">{on ? "Activadas" : "Desactivadas"}</span></Row>
      </Section>

      <Section title="Formulario">
        <form onSubmit={(e) => e.preventDefault()} className="flex max-w-md flex-col gap-4">
          <div className="flex flex-col gap-1.5"><Label htmlFor="ds-name">Nombre</Label><Input id="ds-name" placeholder="Nombre Apellido" /></div>
          <PhoneField label="WhatsApp" prefix="+00" hint="Sin el 0 inicial." />
          <div className="flex flex-col gap-1.5"><Label htmlFor="ds-bad">Campo con error</Label><Input id="ds-bad" aria-invalid="true" defaultValue="valor" /></div>
          <div className="flex flex-col gap-1.5"><span className="text-sm font-bold">Código de verificación</span><CodeInput label="Código" /></div>
          <UploadTile title="Comprobante de identidad" hint="Foto o PDF" done={file} onPick={() => setFile((v) => !v)} />
          <Alert>Mensaje de error de ejemplo.</Alert>
          <Button type="submit" variant="accent" size="lg">Guardar</Button>
        </form>
      </Section>

      <Section title="Avisos, diálogos y toasts">
        <Notice>Si en 24 h nadie responde, el canal pasa a revisión.</Notice>
        <StatusCard tone="warning" icon={Mail} title="En revisión">Estamos revisando tu solicitud.</StatusCard>
        <StatusCard tone="danger" icon={Mail} title="Rechazado" alert>Falta un documento.</StatusCard>
        <SuccessCard icon={FileCheck}><h3 className="m-0 text-[24px]">¡Presupuesto enviado!</h3><p className="m-0 text-subtle">Te avisaremos cuando el cliente responda.</p></SuccessCard>
        <Row><Button variant="outline" onClick={() => setDialog(true)}>Abrir diálogo con motivo</Button><Button variant="outline" onClick={() => setPanel(true)}>Abrir panel lateral</Button><Button onClick={() => show("Copiado al portapapeles")}>Mostrar toast</Button></Row>
      </Section>

      {dialog ? <ReasonDialog title="¿Anular este presupuesto?" description="Se notificará al cliente." onCancel={() => setDialog(false)} onConfirm={() => { setDialog(false); show("Presupuesto anulado"); }} confirmLabel="Anular" /> : null}
      {panel ? <SidePanel title="Presupuesto P-0042" fields={[{ label: "Cliente", value: "Cliente Demo A" }, { label: "Monto", value: formatMoney(3200, "USD") }, { label: "Estado", value: <StatusChip label="Enviada" /> }]} actions={<><Button size="sm" onClick={() => setPanel(false)}>Reenviar</Button><Button size="sm" variant="whatsapp">WhatsApp</Button></>} footnote="Todo cambio queda en el registro de actividad." onClose={() => setPanel(false)} /> : null}
      <Toast message={message} />
    </>
  );
}
