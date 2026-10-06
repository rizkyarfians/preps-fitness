import 'dotenv/config';
import { readConfig } from './config.js';
import { createRuntime } from './runtime.js';
const config = readConfig(process.env);
const runtime = createRuntime(config);
const server = runtime.app.listen(config.PORT, () => console.log(`Preps API listening on port ${config.PORT}`));
let closing = false;
function shutdown() {
 if (closing) return; closing = true;
 const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
 server.close(() => { void runtime.pool.end().then(() => { clearTimeout(timer); process.exit(0); }); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
