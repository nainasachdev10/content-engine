/**
 * Production entrypoint: runs the dashboard and the scheduler together and
 * restarts either if it dies. Used by the Docker image and `npm start`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "3777";

function keepAlive(name, cmd, args, cwd) {
  const start = () => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    child.on("exit", (code) => {
      console.error(`[start] ${name} exited with code ${code}; restarting in 5s`);
      setTimeout(start, 5000);
    });
  };
  start();
}

keepAlive("dashboard", "npx", ["next", "start", "-p", port], join(root, "apps", "dashboard"));
keepAlive("scheduler", "npx", ["tsx", "packages/pipeline/src/cli.ts", "scheduler"], root);
