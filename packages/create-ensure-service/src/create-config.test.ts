import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    createEnsureServiceConfig,
    createEnsureServiceConfigContents,
    defaultConfigFileName,
} from './create-config.js';

describe(createEnsureServiceConfig.name, () => {
    it('writes a runnable ensure-service configuration', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const configPath = join(temporaryDirectory, defaultConfigFileName);

        try {
            await createEnsureServiceConfig({
                configPath,
                cwd: temporaryDirectory,
            });

            const configFileContents = await readFile(configPath, 'utf8');

            assert.isTrue(configFileContents.includes('"serviceStartCommand": "npm run start"'));
            assert.isTrue(configFileContents.includes('"startServiceCwd"'));
            assert.isTrue(configFileContents.includes(temporaryDirectory));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('does not replace an existing configuration without permission', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const configPath = join(temporaryDirectory, defaultConfigFileName);

        try {
            await writeFile(configPath, 'existing configuration');

            await assert.throws(
                createEnsureServiceConfig({
                    configPath,
                    cwd: temporaryDirectory,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('replaces an existing configuration when permitted', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const configPath = join(temporaryDirectory, defaultConfigFileName);

        try {
            await writeFile(configPath, 'existing configuration');
            await createEnsureServiceConfig({
                configPath,
                cwd: temporaryDirectory,
                shouldOverwrite: true,
            });

            assert.isTrue((await readFile(configPath, 'utf8')).startsWith('{'));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('uses the configuration directory for state files', () => {
        const configContents = createEnsureServiceConfigContents({
            configPath: '/home/example/.config/ensure-service/config.json',
            cwd: '/home/example/service',
        });

        assert.isTrue(configContents.includes('/home/example/.config/ensure-service/logs'));
        assert.isTrue(
            configContents.includes('/home/example/.config/ensure-service/ensure-service.lock'),
        );
    });
});
