// `npm run openclaw:upgrade -- <version>`: moves Task Panel to another OpenClaw
// release in one step. The Gateway in the Docker image and the client library
// talking to it must be the same version, so this updates both packages (and
// the lockfile) and the Dockerfile's OPENCLAW_VERSION together, after checking
// that the image for that version has been published.
//
// Dependabot ignores the OpenClaw packages (.github/dependabot.yml) because it
// would bump only one side; upgrades are made on purpose with this script.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packages = ["@openclaw/gateway-client", "@openclaw/gateway-protocol"];
const image = "openclaw/openclaw";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: npm run openclaw:upgrade -- <version>   (e.g. 2026.10.6)");
  process.exit(1);
}

async function imagePublished(tag) {
  const auth = await fetch(`https://ghcr.io/token?scope=repository:${image}:pull`);
  if (!auth.ok) throw new Error(`ghcr.io token request failed: ${auth.status}`);
  const { token } = await auth.json();
  const res = await fetch(`https://ghcr.io/v2/${image}/manifests/${tag}`, {
    method: "HEAD",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
      ].join(", "),
    },
  });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`ghcr.io manifest request failed: ${res.status}`);
  return true;
}

const tag = `${version}-browser`;
if (!(await imagePublished(tag))) {
  console.error(`ghcr.io/${image}:${tag} is not published yet; nothing was changed.`);
  process.exit(1);
}

const install = spawnSync("npm", ["install", "--save-exact", ...packages.map((name) => `${name}@${version}`)], {
  cwd: root,
  stdio: "inherit",
});
if (install.status !== 0) process.exit(install.status ?? 1);

const dockerfilePath = path.join(root, "Dockerfile");
const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
const pattern = /^ARG OPENCLAW_VERSION=\S+$/m;
if (!pattern.test(dockerfile)) {
  console.error("No `ARG OPENCLAW_VERSION=` line in the Dockerfile.");
  process.exit(1);
}
fs.writeFileSync(dockerfilePath, dockerfile.replace(pattern, `ARG OPENCLAW_VERSION=${version}`));

console.log(`OpenClaw ${version}: package.json, package-lock.json and Dockerfile updated.`);
