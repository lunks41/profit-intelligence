// Checks the health endpoint of each service. Usage: pnpm health
const targets = [
  ['web', `http://localhost:${process.env.WEB_PORT ?? 3000}/api/health`],
  ['api', `http://localhost:${process.env.API_PORT ?? 3001}/health`],
  ['worker', `http://localhost:${process.env.WORKER_HEALTH_PORT ?? 3002}/health`],
];
let failed = false;
for (const [name, url] of targets) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${name} ${url} -> ${res.status}`);
    if (!res.ok) failed = true;
  } catch (e) {
    console.log(`FAIL ${name} ${url} -> ${e.message}`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
