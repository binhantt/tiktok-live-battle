const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const net = require('node:net');

const serverDirectory = resolve(__dirname, '..');
const readEnv = (file) => existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};

const definitions = [
  ['api-gateway', 'API', 'API_PORT', 3000, '/api/v1/health', 'cyan'],
  ['tiktok-connector', 'CONN', 'CONNECTOR_PORT', 3002, '/health', 'magenta'],
  ['event-worker', 'WORK', 'WORKER_PORT', 3003, '/health', 'yellow'],
  ['battle-engine', 'BATTLE', 'BATTLE_PORT', 3004, '/health', 'green'],
];

function portIsOccupied(port) {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolvePort(true);
      else reject(error);
    });
    probe.listen({ port, host: '::', exclusive: true }, () => probe.close(() => resolvePort(false)));
  });
}

async function planServices(environment, occupied = portIsOccupied, request = fetch) {
  const services = definitions.map(([project, name, variable, fallback, health, color]) => {
    const port = Number(environment[variable] || fallback);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${variable} phải là cổng từ 1 đến 65535.`);
    return { project, name, port, health, color };
  });
  if (new Set(services.map((service) => service.port)).size !== services.length) {
    throw new Error('API_PORT, CONNECTOR_PORT, WORKER_PORT và BATTLE_PORT phải khác nhau.');
  }
  return Promise.all(services.map(async (service) => {
    if (!await occupied(service.port)) return { ...service, running: false };
    let data;
    try {
      const response = await request(`http://127.0.0.1:${service.port}${service.health}`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) data = await response.json();
    } catch {}
    if (data?.ok !== true || data.service !== service.project) {
      throw new Error(`Cổng ${service.port} đang được ứng dụng khác sử dụng. Đổi cổng hoặc dừng ứng dụng đó rồi chạy lại.`);
    }
    return { ...service, running: true };
  }));
}

async function main() {
  const environment = {
    ...readEnv(resolve(serverDirectory, '.env')),
    ...readEnv(resolve(serverDirectory, '../.env')),
    ...process.env,
  };
  // Check every service before starting anything: duplicate engines can consume
  // commands and mutate the battle even before their HTTP port fails to bind.
  const services = await planServices(environment);
  for (const service of services.filter((item) => item.running)) {
    console.log(`[${service.name}] Đã chạy trên cổng ${service.port}; sử dụng tiến trình hiện tại.`);
  }
  const missing = services.filter((service) => !service.running);
  if (!missing.length) {
    console.log('Server đã sẵn sàng. Không khởi động thêm bản trùng.');
    return;
  }
  const concurrently = require('concurrently');
  await concurrently(missing.map((service) => ({
    command: `nest start ${service.project} --watch`, name: service.name, prefixColor: service.color,
  })), { cwd: serverDirectory, killOthersOn: ['failure'] }).result;
}

if (require.main === module) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Không thể khởi động server.');
  process.exitCode = 1;
});

module.exports = { planServices };
