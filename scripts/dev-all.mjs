#!/usr/bin/env node
/**
 * Starts the web app and the background worker together in one window (`npm run dev:all`), on any operating
 * system, and stops both with one Ctrl+C. No extra package is needed: it is two child processes.
 */
import { spawn } from "node:child_process";

const shell = process.platform === "win32";
const procs = [
  ["web", "npm", ["run", "dev"]],
  ["worker", "npm", ["run", "worker"]],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { shell, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join("\n");
  p.stdout.on("data", (c) => console.log(tag(c)));
  p.stderr.on("data", (c) => console.error(tag(c)));
  p.on("exit", (code) => {
    console.log(`[${name}] stopped (${code ?? "signal"})`);
    stop();
  });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
