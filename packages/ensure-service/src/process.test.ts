import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {spawn, type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {createServer, type Server} from 'node:http';
import {killPortHolderProcesses} from './process.js';

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
