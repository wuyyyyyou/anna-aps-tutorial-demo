import { cp, mkdir, rm } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const bundle = new URL("bundle/", root);
await rm(bundle, { recursive: true, force: true });
await mkdir(bundle, { recursive: true });
await cp(new URL("src/", root), bundle, { recursive: true });
console.log("Built bundle/ from src/.");
