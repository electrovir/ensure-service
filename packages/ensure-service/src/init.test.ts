import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {parseArgs} from 'cli-vir';
import {resolve} from 'node:path';
import {createInitParams, initArgs} from './init.js';

function parseInitFlags(flags: ReadonlyArray<string>) {
    return parseArgs(
        [
            process.execPath,
            import.meta.filename,
            ...flags,
        ],
        initArgs,
        {
            binName: undefined,
            importMeta: import.meta,
            packageJsonPath: undefined,
        },
    );
}

describe(createInitParams.name, () => {
    it('leaves omitted flags undefined so they are prompted for', () => {
        assert.deepEquals(createInitParams(parseInitFlags([])), {
            serviceName: undefined,
            serviceOptions: {
                healthCheckTimeout: undefined,
                healthCheckUrl: undefined,
                lockFilePath: undefined,
                logDirPath: undefined,
                servicePort: undefined,
                serviceStartCommand: undefined,
                serviceStartTimeout: undefined,
                startServiceCwd: undefined,
                useTailscaleService: undefined,
            },
            shouldOverwrite: false,
            shouldSkipPrompts: false,
        });
    });

    it('converts every flag into a service option', () => {
        assert.deepEquals(
            createInitParams(
                parseInitFlags([
                    '--name',
                    'api',
                    '--port',
                    '4000',
                    '--service-start-command',
                    'npm run dev',
                    '--start-service-cwd',
                    'api',
                    '--health-check-url',
                    'https://127.0.0.1:4000/health',
                    '--use-tailscale-service',
                    'false',
                    '--health-check-timeout-seconds',
                    '5',
                    '--service-start-timeout-seconds',
                    '60',
                    '--log-dir-path',
                    'logs',
                    '--lock-file-path',
                    '/tmp/api.lock',
                    '--skip-prompts',
                    '--overwrite',
                ]),
            ),
            {
                serviceName: 'api',
                serviceOptions: {
                    healthCheckTimeout: {
                        seconds: 5,
                    },
                    healthCheckUrl: 'https://127.0.0.1:4000/health',
                    lockFilePath: '/tmp/api.lock',
                    logDirPath: resolve('logs'),
                    servicePort: 4000,
                    serviceStartCommand: 'npm run dev',
                    serviceStartTimeout: {
                        seconds: 60,
                    },
                    startServiceCwd: resolve('api'),
                    useTailscaleService: false,
                },
                shouldOverwrite: true,
                shouldSkipPrompts: true,
            },
        );
    });

    it('rejects a timeout that is not positive', () => {
        assert.throws(
            () => {
                return createInitParams(
                    parseInitFlags([
                        '--health-check-timeout-seconds',
                        '0',
                    ]),
                );
            },
            {
                matchMessage: 'more than 0 seconds',
            },
        );
    });
});
