const { startInfrastructure } = require('../../scripts/start-infrastructure.cjs');

describe('Infrastructure startup before backend', () => {
  it('waits for both project containers to become healthy', () => {
    const run = jest.fn().mockReturnValue({ status: 0 });
    startInfrastructure(run);
    expect(run.mock.calls.map(call => call[1])).toEqual([
      ['info', '--format', '{{.ServerVersion}}'],
      ['compose', 'up', '-d', '--wait', '--wait-timeout', '90', 'mongodb', 'redis'],
    ]);
  });
  it('stops before starting services when Docker Desktop is off', () => {
    const run = jest.fn().mockReturnValue({ status: 1 });
    expect(() => startInfrastructure(run)).toThrow('Docker Desktop chưa sẵn sàng');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('explains that Docker must be installed when the CLI is missing', () => {
    expect(() => startInfrastructure(jest.fn().mockReturnValue({ status: null, error: { code: 'ENOENT' } }))).toThrow('Chưa tìm thấy Docker');
  });
  it('does not continue after container health checks fail', () => {
    const run = jest.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 });
    expect(() => startInfrastructure(run)).toThrow('backend chưa được khởi động');
  });
});
