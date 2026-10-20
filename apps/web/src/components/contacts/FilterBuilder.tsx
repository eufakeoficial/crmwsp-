"use client";

import {
  FILTER_OPERATORS,
  filterConditionSchema,
  filterFieldDef,
  type ContactFilter,
  type ContactSegment,
  type ContactTagCount,
  type FilterCondition,
  type RelativeTime,
} from "@crmwsp/contracts";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button, CheckBox, Input } from "@/components/ui";
import { FIELDS_BY_GROUP, GROUP_LABELS, NO_VALUE, OPERATOR_LABELS, UNIT_LABELS, describeCondition, relationChoices } from "./filter-meta";

interface Props {
  filter: ContactFilter;
  onChange: (next: ContactFilter) => void;
  tags: readonly ContactTagCount[];
  segments: readonly ContactSegment[];
  onSaveSegment?: () => void;
}

/** ManyChat-style chip builder: "+ Condición", one chip per condition, match all/any. */
export function FilterBuilder({ filter, onChange, tags, segments, onSaveSegment }: Props) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const setCondition = (i: number | "new", c: FilterCondition) => {
    const conditions = [...filter.conditions];
    if (i === "new") conditions.push(c);
    else conditions[i] = c;
    onChange({ ...filter, conditions });
    setEditing(null);
  };
  const remove = (i: number) => onChange({ ...filter, conditions: filter.conditions.filter((_, j) => j !== i) });

  return (
    <div className="relative mb-4 flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-white px-3 py-2">
      {filter.conditions.length > 1 ? (
        <label className="flex items-center gap-1 text-[12px] font-bold">
          Cumple
          <select
            aria-label="Coincidencia"
            value={filter.match}
            onChange={(e) => onChange({ ...filter, match: e.target.value as ContactFilter["match"] })}
            className="h-8 rounded-full border-[1.5px] border-line-2 bg-white px-2 text-[12px] font-bold"
          >
            <option value="all">todas</option>
            <option value="any">cualquiera</option>
          </select>
        </label>
      ) : null}
      {filter.conditions.map((c, i) => (
        <span key={i} className="inline-flex h-8 items-center gap-1 rounded-full border-[1.5px] border-ink bg-ink pl-3 pr-1 text-[12px] font-bold text-white">
          <button type="button" className="cursor-pointer bg-transparent p-0 text-white" onClick={() => setEditing(i)}>
            {describeCondition(c, { segments })}
          </button>
          <button type="button" aria-label="Quitar condición" className="grid size-6 cursor-pointer place-items-center rounded-full bg-transparent p-0 text-white hover:bg-white/20" onClick={() => remove(i)}>
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {filter.conditions.length < 20 ? (
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Condición
        </Button>
      ) : null}
      {filter.conditions.length && onSaveSegment ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onSaveSegment}>
          Guardar segmento
        </Button>
      ) : null}
      {editing !== null ? (
        <ConditionEditor
          initial={editing === "new" ? undefined : filter.conditions[editing]}
          tags={tags}
          segments={segments}
          onCancel={() => setEditing(null)}
          onApply={(c) => setCondition(editing, c)}
        />
      ) : null}
    </div>
  );
}

function ConditionEditor({
  initial,
  tags,
  segments,
  onApply,
  onCancel,
}: {
  initial: FilterCondition | undefined;
  tags: readonly ContactTagCount[];
  segments: readonly ContactSegment[];
  onApply: (c: FilterCondition) => void;
  onCancel: () => void;
}) {
  const [field, setField] = useState(initial?.field ?? "");
  const [customKey, setCustomKey] = useState("");
  const def = field ? filterFieldDef(field) : undefined;
  const [operator, setOperator] = useState(initial?.operator ?? "");
  // Number fields keep the typed text (major units for money) and convert on apply.
  const [value, setValue] = useState<unknown>(() => {
    if (initial?.type !== "number" || initial.value === undefined) return initial?.value;
    return String(filterFieldDef(initial.field)?.minorUnits ? Number(initial.value) / 100 : initial.value);
  });
  const [search, setSearch] = useState("");

  const pickField = (key: string) => {
    const d = filterFieldDef(key);
    if (!d) return;
    setField(key);
    setOperator(FILTER_OPERATORS[d.type][0]);
    setValue(undefined);
  };

  if (!def) {
    return (
      <Popover onCancel={onCancel}>
        {FIELDS_BY_GROUP.map(({ group, fields }) => (
          <div key={group} className="mb-2">
            <p className="m-0 mb-1 text-[11px] font-bold uppercase text-muted">{GROUP_LABELS[group]}</p>
            <div className="flex flex-wrap gap-1">
              {fields.map((f) => (
                <Button key={f.key} variant="outline" size="sm" onClick={() => pickField(f.key)}>
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
        <p className="m-0 mb-1 text-[11px] font-bold uppercase text-muted">{GROUP_LABELS.custom}</p>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const key = customKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
            if (key) pickField(`cf:${key}`);
          }}
        >
          <Input aria-label="Campo personalizado" placeholder="clave, p. ej. ciudad" value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
          <Button type="submit" variant="outline" size="sm">Usar</Button>
        </form>
      </Popover>
    );
  }

  const isRelative = operator === "less_than_ago" || operator === "more_than_ago";
  const rel = (value as RelativeTime | undefined) ?? { amount: 1, unit: "days" as const };
  const numberValue = (): number | undefined => {
    if (value === undefined || value === "") return undefined;
    const n = Number(value);
    return def.minorUnits ? Math.round(n * 100) : n;
  };
  const candidate: FilterCondition = {
    field,
    type: def.type,
    operator,
    ...(NO_VALUE.has(operator) ? {} : { value: isRelative ? rel : def.type === "number" ? numberValue() : value }),
  };
  const valid = filterConditionSchema.safeParse(candidate).success;
  const choices = def.type === "relation" ? relationChoices(field, tags, segments).filter((c) => c.label.toLowerCase().includes(search.toLowerCase())) : [];
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setValue([...next]);
  };

  return (
    <Popover onCancel={onCancel}>
      <p className="m-0 mb-2 font-bold">{def.label}</p>
      <select
        aria-label="Operador"
        value={operator}
        onChange={(e) => {
          setOperator(e.target.value);
          if (def.type === "date") setValue(undefined);
        }}
        className="mb-2 h-9 w-full rounded-[10px] border-[1.5px] border-line-2 bg-white px-2 text-sm"
      >
        {FILTER_OPERATORS[def.type].map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[def.type][op]}
          </option>
        ))}
      </select>
      {NO_VALUE.has(operator) ? null : def.type === "relation" ? (
        <div>
          {field === "tag" || field === "segment" ? (
            <Input aria-label="Buscar" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
          ) : null}
          <ul className="m-0 mt-2 max-h-56 list-none overflow-auto p-0">
            {choices.length === 0 ? <li className="text-sm text-muted">Sin opciones</li> : null}
            {choices.map((c) => (
              <li key={c.value} className="flex items-center gap-2 py-1 text-sm">
                <CheckBox checked={selected.has(c.value)} onChange={() => toggle(c.value)} label={c.label} />
                <span className="flex-1 truncate">{c.label}</span>
                {c.count !== undefined ? <span className="text-muted">{c.count}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : isRelative ? (
        <div className="flex items-center gap-2">
          <span className="text-sm">hace</span>
          <Input
            aria-label="Cantidad"
            type="number"
            min={1}
            value={String(rel.amount)}
            onChange={(e) => setValue({ ...rel, amount: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          />
          <select
            aria-label="Unidad"
            value={rel.unit}
            onChange={(e) => setValue({ ...rel, unit: e.target.value as RelativeTime["unit"] })}
            className="h-9 rounded-[10px] border-[1.5px] border-line-2 bg-white px-2 text-sm"
          >
            {Object.entries(UNIT_LABELS).map(([u, l]) => (
              <option key={u} value={u}>
                {l}
              </option>
            ))}
          </select>
        </div>
      ) : def.type === "date" ? (
        <Input aria-label="Fecha" type="date" value={typeof value === "string" ? value : ""} onChange={(e) => setValue(e.target.value)} />
      ) : def.type === "number" ? (
        <Input
          aria-label={def.minorUnits ? "Importe" : "Valor"}
          type="number"
          step={def.minorUnits ? "0.01" : "1"}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : (
        <Input aria-label="Valor" maxLength={200} value={typeof value === "string" ? value : ""} onChange={(e) => setValue(e.target.value)} />
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" disabled={!valid} onClick={() => onApply(candidate)}>Aplicar</Button>
      </div>
    </Popover>
  );
}

function Popover({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Condición"
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      className="absolute left-0 top-full z-40 mt-2 w-[min(100%,360px)] rounded-[18px] border border-line bg-white p-4 shadow-lg"
    >
      {children}
    </div>
  );
}
