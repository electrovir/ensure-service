import {type PartialWithUndefined} from '@augment-vir/common';
import {runShellCommand} from '@augment-vir/node';
import {input, number} from '@inquirer/prompts';
import {
    defaultTailscaleKeyFilePath,
    ensureTailscaleKeyFile,
    serviceNameShape,
} from 'ensure-service';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {checkValidShape} from 'object-shape-tester';
import {removeNonInteractiveBashGuard} from './bashrc.js';
import {createEnsureServiceConfig, defaultConfigFileName} from './create-config.js';
import {installEnsureServiceCron} from './setup.js';
import {findTailscaleOperatorCommand} from './tailscale-operator.js';

async function promptForServiceName({
    defaultName,
    usedNames,
}: Readonly<{
    defaultName: string;
    usedNames: ReadonlyArray<string>;
}>) {
    return await input({
        message: 'What should this service be named?',
        default: defaultName,
        required: true,
        validate(name) {
            if (!checkValidShape(name, serviceNameShape)) {
                return 'Use lowercase letters, digits, and inner hyphens (at most 63 characters).';
            }
            return usedNames.includes(name) ? `Service '${name}' already exists.` : true;
        },
    });
}

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
 * Prompts for the service's name and port when `serviceName` or `servicePort` are omitted and the
 * current directory is not already configured.
 *
 * @category Main
 */
export async function runInitCli({
    serviceName,
    servicePort,
    shouldOverwrite,
}: Readonly<
    PartialWithUndefined<{
        serviceName: string;
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
        getServiceName: serviceName ? () => serviceName : promptForServiceName,
        getServicePort: servicePort == undefined ? promptForServicePort : () => servicePort,
        shouldOverwrite,
    });

    if (serviceName && configResult.serviceName !== serviceName) {
        throw new Error(
            `This directory is already configured as '${configResult.serviceName}'. Rename it in '${configPath}' instead.`,
        );
    }

    await ensureTailscaleKeyFile(defaultTailscaleKeyFilePath);
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
        tailscaleKeyFilePath: defaultTailscaleKeyFilePath,
        tailscaleOperatorCommand: await findTailscaleOperatorCommand(),
    };
}
