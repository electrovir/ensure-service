import {type PartialWithUndefined} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {number} from '@inquirer/prompts';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {removeNonInteractiveBashGuard} from './bashrc.js';
import {createEnsureServiceConfig, defaultConfigFileName} from './create-config.js';
import {installEnsureServiceCron} from './setup.js';

async function promptForServicePort({
    defaultPort,
    usedPorts,
}: Readonly<{
    defaultPort: number;
    usedPorts: ReadonlyArray<number>;
}>) {
    return await number({
        message: 'Which port does this service listen on?',
        default: defaultPort,
        min: 1,
        max: 65_535,
        required: true,
        validate(port) {
            return usedPorts.includes(port)
                ? `Port ${port} is already used by another service.`
                : true;
        },
    });
}

/**
 * Install (if not already installed globally) and configure ensure-service for the current user.
 * Prompts for the service's port when `servicePort` is omitted and the current directory is not
 * already configured.
 *
 * @category Main
 */
export async function runInitCli({
    servicePort,
    shouldOverwrite,
}: Readonly<
    PartialWithUndefined<{
        servicePort: number;
        shouldOverwrite: boolean;
    }>
>) {
    const homePath = homedir();
    const configPath = join(homePath, '.config', 'ensure-service', defaultConfigFileName);

    const didInstall = !!(await runShellCommand('npm ls --global --depth=0 ensure-service'))
        .exitCode;

    if (didInstall) {
        await runShellCommand('npm install --global ensure-service', {
            hookUpToConsole: true,
            rejectOnError: true,
        });
    }
    const configResult = await createEnsureServiceConfig({
        configPath,
        cwd: process.cwd(),
        getServicePort: servicePort == undefined ? promptForServicePort : () => servicePort,
        shouldOverwrite,
    });
    await removeNonInteractiveBashGuard({
        bashrcPath: join(homePath, '.bashrc'),
    });
    await installEnsureServiceCron({
        configPath,
        homePath,
    });

    return {
        ...configResult,
        configPath,
        didInstall,
    };
}
