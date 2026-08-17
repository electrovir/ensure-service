import {type PartialWithUndefined} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createEnsureServiceConfig, defaultConfigFileName} from './create-config.js';
import {installEnsureServiceCron} from './setup.js';

/**
 * Install and configure ensure-service for the current user.
 *
 * @category Main
 */
export async function runInitCli({
    shouldOverwrite,
}: Readonly<PartialWithUndefined<{shouldOverwrite: boolean}>>): Promise<{configPath: string}> {
    const homePath = homedir();
    const configPath = join(homePath, '.config', 'ensure-service', defaultConfigFileName);

    await runShellCommand('npm install --global ensure-service', {
        hookUpToConsole: true,
        rejectOnError: true,
    });
    await createEnsureServiceConfig({
        configPath,
        cwd: process.cwd(),
        shouldOverwrite,
    });
    await installEnsureServiceCron({
        configPath,
        homePath,
    });

    return {
        configPath,
    };
}
