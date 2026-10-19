import { useId } from "react";

/** Phone (WhatsApp) with the country prefix attached on the left, e.g. "+00" (required: comes from the tenant/contact country). */
export function PhoneField({
  label,
  prefix,
  hint,
  name = "phone",
  value,
  onChange,
  placeholder,
}: {
  label: string;
  prefix: string;
  hint?: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-bold">{label}</label>
      <span className="flex h-12 overflow-hidden rounded-[14px] border-[1.5px] border-ink bg-white focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus">
        <span className="flex items-center border-r border-line bg-paper px-3.5 text-sm font-bold whitespace-nowrap">{prefix}</span>
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...(value !== undefined ? { value } : {})}
          onChange={(e) => onChange?.(e.target.value)}
          className="min-w-0 flex-1 border-0 px-3.5 text-[16px] font-semibold text-ink outline-none"
        />
      </span>
      {hint ? <span id={`${id}-hint`} className="text-sm text-muted">{hint}</span> : null}
    </div>
  );
}
