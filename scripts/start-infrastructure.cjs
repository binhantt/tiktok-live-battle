const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const directory = resolve(__dirname, '..');

function startInfrastructure(run = spawnSync) {
  const docker = run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    cwd: directory, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  if (docker.error?.code === 'ENOENT') throw new Error('Chưa tìm thấy Docker. Cài Docker Desktop rồi chạy lại pnpm dev:server.');
  if (docker.status !== 0 || docker.error) throw new Error('Docker Desktop chưa sẵn sàng. Mở Docker Desktop, chờ Engine running, rồi chạy lại pnpm dev:server.');
  console.log('Đang bật và chờ MongoDB / Redis sẵn sàng…');
  const compose = run('docker', ['compose', 'up', '-d', '--wait', '--wait-timeout', '90', 'mongodb', 'redis'], {
    cwd: directory, stdio: 'inherit', windowsHide: true,
  });
  if (compose.status !== 0 || compose.error) throw new Error('MongoDB / Redis chưa sẵn sàng. Kiểm tra log Docker và các cổng MONGODB_PORT / REDIS_PORT trong .env; backend chưa được khởi động.');
  console.log('MongoDB / Redis đã sẵn sàng.');
}

if (require.main === module) {
  try { startInfrastructure(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { startInfrastructure };
