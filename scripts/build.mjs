import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const dist = new URL("../dist/", import.meta.url);
const files = [
  "index.html",
  "styles.css",
  "home.css",
  "modal.css",
  "app.js",
  "dice.html",
  "dice.css",
  "dice.js",
  "room.css",
  "room.js",
  "game-screen.css",
  "game-outline.js",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of files) {
  await cp(new URL(file, root), new URL(file, dist));
}

await cp(new URL("assets", root), new URL("assets", dist), { recursive: true });
const output = await readdir(dist);
console.log(`Built ${output.length} top-level entries in ${join(dist.pathname)}`);
