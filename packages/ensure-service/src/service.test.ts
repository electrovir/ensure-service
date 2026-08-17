import {assert, waitUntil} from '@augment-vir/assert';
import {shellQuote} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {runHealthCheck, startService} from './service.js';

async function listenOnAvailablePort(server: Server) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const serverAddress = server.address();

    assert.isDefined(serverAddress);
    assert.isNotString(serverAddress);

    return serverAddress.port;
}

async function closeServer(server: Server) {
    server.close();
    await once(server, 'close');
}

describe(runHealthCheck.name, () => {
    it('returns true for a successful response', async () => {
        const server = createServer((_request, response) => {
            response.end();
        });
        const port = await listenOnAvailablePort(server);

        try {
            assert.isTrue(
                await runHealthCheck({
                    healthCheckTimeout: {
                        seconds: 1,
                    },
                    healthCheckUrl: `http://127.0.0.1:${port}/health`,
                }),
            );
        } finally {
            await closeServer(server);
        }
    });

    it('returns false for an unsuccessful response', async () => {
        const server = createServer((_request, response) => {
            response.statusCode = 503;
            response.end();
        });
        const port = await listenOnAvailablePort(server);

        try {
            assert.isFalse(
                await runHealthCheck({
                    healthCheckTimeout: {
                        seconds: 1,
                    },
                    healthCheckUrl: `http://127.0.0.1:${port}/health`,
                }),
            );
        } finally {
            await closeServer(server);
        }
    });

    it('returns false when the health-check server is unavailable', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        await closeServer(server);

        assert.isFalse(
            await runHealthCheck({
                healthCheckTimeout: {
                    seconds: 1,
                },
                healthCheckUrl: `http://127.0.0.1:${port}/health`,
            }),
        );
    });
});

describe(startService.name, () => {
    it('starts a shell command and captures its output in a log file', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const logDirPath = join(temporaryDirectory, 'logs');

        try {
            const logPath = await startService({
                logDirPath,
                serviceStartCommand: [
                    shellQuote(process.execPath),
                    '--eval',
                    shellQuote("process.stdout.write('service started');"),
                ].join(' '),
                startServiceCwd: temporaryDirectory,
            });

            assert.strictEquals(dirname(logPath), logDirPath);
            await waitUntil.isTrue(
                async () => (await readFile(logPath, 'utf8')).includes('service started'),
                {
                    interval: {
                        milliseconds: 10,
                    },
                    timeout: {
                        seconds: 1,
                    },
                },
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
