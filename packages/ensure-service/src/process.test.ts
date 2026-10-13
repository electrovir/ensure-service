// cspell:word pgid pgrep ppid

import {assert, assertWrap, waitUntil} from '@augment-vir/assert';
import {randomString, shellQuote} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer, type Server} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    killPortHolderProcesses,
    killServiceProcessGroups,
    listServiceProcessGroups,
    parseServiceProcessGroups,
} from './process.js';
import {startService} from './service.js';

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

async function stopChildProcess(childProcess: ChildProcess) {
    if (childProcess.exitCode == undefined && childProcess.signalCode == undefined) {
        const didExit = once(childProcess, 'exit');

        childProcess.kill('SIGKILL');
        await didExit;
    }
}

function startPortHolder({
    ignoreSigterm,
    port,
}: Readonly<{
    ignoreSigterm: boolean;
    port: number;
}>) {
    return spawn(
        process.execPath,
        [
            '--eval',
            [
                "const server = require('node:http').createServer();",
                `server.listen(${port}, '127.0.0.1', () => process.stdout.write('listening'));`,
                ignoreSigterm ? "process.on('SIGTERM', () => {});" : '',
            ].join(' '),
        ],
        {
            stdio: [
                'ignore',
                'pipe',
                'ignore',
            ],
        },
    );
}

describe(killPortHolderProcesses.name, () => {
    it('rejects an invalid port before invoking lsof', async () => {
        await assert.throws(killPortHolderProcesses(0), {
            matchMessage: 'valid port',
        });
    });

    it('terminates the process holding the port', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        await closeServer(server);
        const childProcess = startPortHolder({
            ignoreSigterm: false,
            port,
        });

        assert.isDefined(childProcess.stdout);
        await once(childProcess.stdout, 'data');

        try {
            assert.isDefined(childProcess.pid);

            const didExit = once(childProcess, 'exit');

            assert.deepEquals(await killPortHolderProcesses(port), [childProcess.pid]);
            await didExit;
        } finally {
            await stopChildProcess(childProcess);
        }
    });

    it('force kills a port holder that ignores SIGTERM', async () => {
        const server = createServer();
        const port = await listenOnAvailablePort(server);
        await closeServer(server);
        const childProcess = startPortHolder({
            ignoreSigterm: true,
            port,
        });

        assert.isDefined(childProcess.stdout);
        await once(childProcess.stdout, 'data');

        try {
            assert.isDefined(childProcess.pid);

            const didExit = once(childProcess, 'exit');

            assert.deepEquals(await killPortHolderProcesses(port), [childProcess.pid]);
            await didExit;
        } finally {
            await stopChildProcess(childProcess);
        }
    });
});

describe(listServiceProcessGroups.name, () => {
    it('lists a started service with every process in its group', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const serviceName = `test-${randomString(8)}`;

        try {
            await startService({
                logDirPath: join(temporaryDirectory, 'logs'),
                serviceName,
                serviceStartCommand: [
                    shellQuote(process.execPath),
                    '--eval',
                    shellQuote('setTimeout(() => {}, 10_000);'),
                ].join(' '),
                startServiceCwd: temporaryDirectory,
            });

            const processGroups = (await listServiceProcessGroups()).filter(
                (processGroup) => processGroup.serviceName === serviceName,
            );

            assert.isLengthExactly(processGroups, 1);
            /** The labeled shell and the node process it started. */
            assert.isLengthExactly(processGroups[0].processes, 2);

            process.kill(-assertWrap.isDefined(processGroups[0].processGroupIds[0]));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});

describe(killServiceProcessGroups.name, () => {
    it('kills a service along with a descendant in its own process group', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const serviceName = `test-${randomString(8)}`;

        try {
            await startService({
                logDirPath: join(temporaryDirectory, 'logs'),
                serviceName,
                serviceStartCommand: [
                    shellQuote(process.execPath),
                    '--eval',
                    shellQuote(
                        [
                            "require('node:child_process').spawn(process.execPath, ['--eval', 'setTimeout(() => {}, 10_000);'], {detached: true, stdio: 'ignore'});",
                            'setTimeout(() => {}, 10_000);',
                        ].join(' '),
                    ),
                ].join(' '),
                startServiceCwd: temporaryDirectory,
            });

            await waitUntil.isLengthExactly(
                2,
                async () => {
                    return (await listServiceProcessGroups())
                        .filter((serviceProcesses) => serviceProcesses.serviceName === serviceName)
                        .flatMap(({processGroupIds}) => processGroupIds);
                },
                {
                    timeout: {
                        seconds: 5,
                    },
                },
            );

            const killedProcessGroupIds = await killServiceProcessGroups(serviceName);

            assert.isLengthExactly(killedProcessGroupIds, 2);
            killedProcessGroupIds.forEach((processGroupId) => {
                assert.throws(() => process.kill(-processGroupId, 0));
            });
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});

describe(parseServiceProcessGroups.name, () => {
    it("includes groups led by a service's descendants", () => {
        assert.deepEquals(
            parseServiceProcessGroups(
                [
                    String.raw`  100     1   100 /bin/sh -c npm run start\012exit $? ensure-service:api`,
                    '  101   100   100 npm run start',
                    '  102   101   102 node runner.js',
                    '  103   102   103 node backend.js',
                    '  104   103   103 node worker.js',
                    String.raw`  200     1   200 /bin/sh -c npm run start\012exit $? ensure-service:web`,
                    '  201   200   200 node web.js',
                ].join('\n'),
            ).map((serviceProcesses) => {
                return {
                    processGroupIds: serviceProcesses.processGroupIds,
                    processIds: serviceProcesses.processes.map(({processId}) => processId),
                    serviceName: serviceProcesses.serviceName,
                };
            }),
            [
                {
                    processGroupIds: [
                        100,
                        102,
                        103,
                    ],
                    processIds: [
                        100,
                        101,
                        102,
                        103,
                        104,
                    ],
                    serviceName: 'api',
                },
                {
                    processGroupIds: [
                        200,
                    ],
                    processIds: [
                        200,
                        201,
                    ],
                    serviceName: 'web',
                },
            ],
        );
    });

    it('ignores processes that only mention a label', () => {
        assert.deepEquals(
            parseServiceProcessGroups(
                [
                    String.raw`  100     1   100 /bin/sh -c npm run start\012exit $? ensure-service:api`,
                    '  101   100   100 npm run start',
                    '  200     1   200 pgrep -f ensure-service:api',
                    '  300     1   300 node server.js',
                ].join('\n'),
            ),
            [
                {
                    processes: [
                        {
                            command: String.raw`/bin/sh -c npm run start\012exit $? ensure-service:api`,
                            processId: 100,
                        },
                        {
                            command: 'npm run start',
                            processId: 101,
                        },
                    ],
                    processGroupIds: [
                        100,
                    ],
                    serviceName: 'api',
                },
            ],
        );
    });
});
