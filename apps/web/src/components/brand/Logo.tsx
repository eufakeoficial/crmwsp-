import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Lime square with the WhatsApp glyph (brand mark). */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/logo-mark.png"
      alt=""
      aria-hidden
      width={size}
      height={size}
      className={cn("flex-none", className)}
    />
  );
}

/** "Vende+ WSP" logo. `inverted` uses the white wordmark for dark backgrounds. */
export function Logo({ href = "/", inverted = false, className }: { href?: string; inverted?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center no-underline", className)}>
      <Image
        src={inverted ? "/brand/logo-on-dark.png" : "/brand/logo-on-light.png"}
        alt="Vende+ WSP"
        width={inverted ? 916 : 920}
        height={inverted ? 308 : 309}
        priority
        className="h-9 w-auto"
      />
    </Link>
  );
}
