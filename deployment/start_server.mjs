// Control the standalone listener so PID 1 drains HTTP requests on SIGTERM.
process.env.ASTRO_NODE_AUTOSTART = "disabled";
const entry = new URL("../dist/server/entry.mjs", import.meta.url);
const { startServer } = await import(entry.href);
const { server, done } = startServer();
let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;
  // Stay below Docker's default 10-second stop deadline. A failed drain is an error.
  const deadline = setTimeout(() => {
    server.server.closeAllConnections();
    process.exit(1);
  }, 8000);
  server.server.close(() => {
    clearTimeout(deadline);
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
await done;
