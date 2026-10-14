import {log, type PartialWithUndefined} from '@augment-vir/common';
import {input, number} from '@inquirer/prompts';
import {type ArgDefinitions, ArgValueType, FlagRequirement} from 'cli-vir';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {checkValidShape} from 'object-shape-tester';
import {removeNonInteractiveBashGuard} from './bashrc.js';
import {defaultConfigPath, serviceNameShape} from './config.js';
import {ConfigUpdate, createEnsureServiceConfig} from './create-config.js';
import {installEnsureServiceCron} from './setup.js';
import {findTailscaleOperatorCommand} from './tailscale-operator.js';
import {defaultTailscaleKeyFilePath, ensureTailscaleKeyFile} from './tailscale.js';

/**
 * CLI flags accepted by `ensure-service init` and `create-ensure-service`.
 *
 * @category Internal
 */
export const initArgs = {
    name: {
        description: 'Name for this service. When omitted, you are prompted for it.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.String,
    },
    overwrite: {
        description:
            'Replace an existing configuration file with one containing only this service.',
        flag: {
            valueRequirement: FlagRequirement.Blocked,
        },
        type: ArgValueType.Boolean,
    },
    port: {
        description: 'Port this service listens on. When omitted, you are prompted for it.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.Number,
    },
} satisfies ArgDefinitions;

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
 * Configure the current directory as a service and run ensure-service once per minute through a
 * cron, then log what changed. Prompts for the service's name and port when `serviceName` or
 * `servicePort` are omitted and the current directory is not already configured. The cron runs the
 * globally installed `ensure-service`, which this does not install.
 *
 * @category Main
 */
export async function runInit({
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

    const configResult = await createEnsureServiceConfig({
        configPath: defaultConfigPath,
        cwd: process.cwd(),
        getServiceName: serviceName ? () => serviceName : promptForServiceName,
        getServicePort: servicePort == undefined ? promptForServicePort : () => servicePort,
        shouldOverwrite,
    });

    if (serviceName && configResult.serviceName !== serviceName) {
        throw new Error(
            `This directory is already configured as '${configResult.serviceName}'. Rename it in '${defaultConfigPath}' instead.`,
        );
    }

    await ensureTailscaleKeyFile(defaultTailscaleKeyFilePath);
    await removeNonInteractiveBashGuard({
        bashrcPath: join(homePath, '.bashrc'),
    });
    await installEnsureServiceCron({
        configPath: defaultConfigPath,
        homePath,
    });

    const tailscaleOperatorCommand = await findTailscaleOperatorCommand();

    const configUpdateMessages: Record<ConfigUpdate, string> = {
        [ConfigUpdate.Created]: `Created ${defaultConfigPath} with service '${configResult.serviceName}' on port ${configResult.servicePort}.`,
        [ConfigUpdate.Added]: `Added service '${configResult.serviceName}' on port ${configResult.servicePort} to ${defaultConfigPath}.`,
        [ConfigUpdate.Unchanged]: `Service '${configResult.serviceName}' is already in ${defaultConfigPath}.`,
    };

    log.success(
        [
            configUpdateMessages[configResult.configUpdate],
            `To use Tailscale Services, fill in ${defaultTailscaleKeyFilePath}.`,
            ...(tailscaleOperatorCommand
                ? [
                      `To use Tailscale Services on this device, also run '${tailscaleOperatorCommand}' once.`,
                  ]
                : []),
            'Configured ensure-service to run once per minute.',
        ].join('\n'),
    );
}
