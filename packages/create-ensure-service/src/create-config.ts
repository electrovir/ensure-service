import {type ConfigOptions} from 'ensure-service';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

/**
 * Default file name written by this initializer.
 *
 * @category Internal
 */
export const defaultConfigFileName = 'config.json';

/**
 * Create the default JSON configuration for the service being initialized.
 *
 * @category Internal
 */
export function createEnsureServiceConfigContents({
    configPath,
    cwd,
}: Readonly<{
    configPath: string;
    cwd: string;
}>) {
    return (
        JSON.stringify(
            {
                healthCheckTimeout: {
                    seconds: 10,
                },
                lockFilePath: join(dirname(configPath), 'ensure-service.lock'),
                logDirPath: join(dirname(configPath), 'logs'),
                servicePort: 3000,
                serviceStartCommand: 'npm run start',
                startServiceCwd: cwd,
            } satisfies ConfigOptions,
            undefined,
            4,
        ) + '\n'
    );
}

/**
 * Write a starter service configuration, replacing an existing file only when permitted.
 *
 * @category Internal
 */
export async function createEnsureServiceConfig({
    configPath,
    cwd,
    shouldOverwrite,
}: Readonly<{
    configPath: string;
    cwd: string;
    shouldOverwrite?: boolean | undefined;
}>) {
    await mkdir(dirname(configPath), {
        recursive: true,
    });

    await writeFile(
        configPath,
        createEnsureServiceConfigContents({
            configPath,
            cwd,
        }),
        {
            flag: shouldOverwrite ? 'w' : 'wx',
        },
    );
}
