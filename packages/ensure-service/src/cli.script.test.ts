import {assert} from '@augment-vir/assert';
import {selectFrom, shellQuote} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {describe, it} from '@augment-vir/test';
import {once} from 'node:events';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {type ConfigOptions} from './config.js';

function createCheckServerOptions({
    logDirPath,
    lockFilePath,
    port,
}: Readonly<{
    logDirPath: string;
    lockFilePath: string;
    port: number;
}>) {
    return {
        healthCheckTimeout: {
            seconds: 1,
        },
        healthCheckUrl: `http://127.0.0.1:${port}/`,
        logDirPath,
        lockFilePath,
        servicePort: port,
        serviceStartCommand: process.execPath,
        startServiceCwd: process.cwd(),
    } satisfies ConfigOptions;
}

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

async function runEnsureServiceCli(configPath: string) {
    return runShellCommand(
        [
            'tsx',
            shellQuote(join(import.meta.dirname, 'cli.script.ts')),
            shellQuote(configPath),
        ].join(' '),
    );
}

describe('cli.script.ts', () => {
    it('loads service options from a config with unrelated properties', async () => {
        const server = createServer((_request, response) => {
            response.end();
        });
        const port = await listenOnAvailablePort(server);
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const configPath = join(temporaryDirectory, 'ensure-service.config.json');

        await writeFile(
            configPath,
            JSON.stringify({
                ...createCheckServerOptions({
                    logDirPath: join(temporaryDirectory, 'logs'),
                    lockFilePath: join(temporaryDirectory, 'ensure.lock'),
                    port,
                }),
                healthTimeout: {
                    seconds: 1,
                },
            }),
        );

        try {
            assert.deepEquals(
                selectFrom(await runEnsureServiceCli(configPath), {
                    error: true,
                    exitCode: true,
                    exitSignal: true,
                }),
                {
                    error: undefined,
                    exitCode: 0,
                    exitSignal: undefined,
                },
            );
        } finally {
            await closeServer(server);
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('rejects an invalid config file', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const configPath = join(temporaryDirectory, 'ensure-service.config.json');

        await writeFile(
            configPath,
            JSON.stringify({
                healthCheckUrl: -1,
            }),
        );

        try {
            assert.isDefined((await runEnsureServiceCli(configPath)).error);
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
