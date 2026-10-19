// Bundles the API with esbuild. Workspace packages (@crmwsp/*) export .ts
// sources, so they are bundled in, together with their own npm dependencies
// (pnpm does not hoist them to apps/api). Direct npm dependencies of
// apps/api stay external and load from node_modules at runtime. Type checking stays with `tsc --noEmit`.
// Decorator metadata is not emitted by esbuild: all Nest DI uses explicit @Inject.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = new Set(Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@crmwsp/")));
const pkgName = (p) => p.split("/").slice(0, p.startsWith("@") ? 2 : 1).join("/");

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  // Node builtins without the node: prefix are external via platform=node.
  target: "node22",
  format: "cjs",
  sourcemap: true,
  logLevel: "warning",
  plugins: [
    {
      name: "external-npm-deps",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("node:") || external.has(pkgName(args.path))
            ? { path: args.path, external: true }
            : undefined,
        );
      },
    },
  ],
});
