import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { Network } from "lucide";
await mkdir("assets/vendor", { recursive: true });
for (const [from, to] of [
  ["node_modules/echarts/dist/echarts.min.js", "echarts.min.js"],
  ["node_modules/echarts/LICENSE", "echarts-LICENSE.txt"],
  ["node_modules/echarts/NOTICE", "echarts-NOTICE.txt"],
  ["node_modules/lucide/dist/umd/lucide.min.js", "lucide.min.js"],
  ["node_modules/lucide/LICENSE", "lucide-LICENSE.txt"],
])
  await copyFile(from, `assets/vendor/${to}`);
const nodes = Network.map(
  ([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ")}/>`,
).join("");
await writeFile(
  "assets/favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#147d65"/><g transform="translate(4 4)" fill="none" stroke="white" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${nodes}</g></svg>`,
);
