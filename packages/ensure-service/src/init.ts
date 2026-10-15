import {log, omitObjectKeys, type PartialWithUndefined, wrapInTry} from '@augment-vir/common';
import {confirm, input, number} from '@inquirer/prompts';
import {type ArgDefinitions, ArgValueType, FlagRequirement, type ParsedArgs} from 'cli-vir';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {checkValidShape} from 'object-shape-tester';
import {parseUrl} from 'url-vir';
import {removeNonInteractiveBashGuard} from './bashrc.js';
import {
    defaultConfigPath,
    resolveServiceOptions,
    serviceNameShape,
    type ServiceOptions,
} from './config.js';
import {ConfigUpdate, createEnsureServiceConfig} from './create-config.js';
import {installEnsureServiceCron} from './setup.js';
import {findTailscaleOperatorCommand} from './tailscale-operator.js';
import {
    defaultTailscaleKeyFilePath,
    ensureTailscaleKeyFile,
    readTailscaleOauthClient,
} from './tailscale.js';

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
    skipPrompts: {
        description:
            'Do not prompt for anything. Options without a flag use their defaults, as if every prompt was left blank.',
        flag: {
            valueRequirement: FlagRequirement.Blocked,
        },
        type: ArgValueType.Boolean,
    },
    serviceStartCommand: {
        description: 'Command that starts this service. When omitted, you are prompted for it.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.String,
    },
    startServiceCwd: {
        description:
            'Directory to run the start command from. When omitted, you are prompted for it.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.String,
    },
    healthCheckUrl: {
        description:
            'URL to send the health check request to. When omitted, you are prompted for it.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.String,
    },
    useTailscaleService: {
        description:
            'Whether to run this service as a Tailscale service. When omitted, you are prompted for it unless the config sets it at the top level.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        /** A boolean flag cannot be told apart from an omitted flag when it's set to `false`. */
        type: [
            'true',
            'false',
        ],
    },
    healthCheckTimeoutSeconds: {
        description: 'How long the health check may take, in seconds.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.Number,
    },
    serviceStartTimeoutSeconds: {
        description: 'How long the service may take to start, in seconds.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.Number,
    },
    logDirPath: {
        description: 'Directory that service log files are written into.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.String,
    },
    lockFilePath: {
        description: 'Path to the lock file preventing overlapping runs.',
        flag: {
            valueRequirement: FlagRequirement.Required,
        },
        type: ArgValueType.String,
    },
} satisfies ArgDefinitions;

function createSecondsDuration(seconds: number | false) {
    if (seconds === false) {
        return undefined;
    } else if (seconds <= 0) {
        throw new Error(`Timeouts must be more than 0 seconds, got ${seconds}.`);
    } else {
        return {
            seconds,
        };
    }
}

/**
 * Convert the values parsed from {@link initArgs} into {@link runInit}'s params.
 *
 * @category Internal
 */
export function createInitParams({
    healthCheckTimeoutSeconds,
    healthCheckUrl,
    lockFilePath,
    logDirPath,
    name,
    overwrite,
    port,
    serviceStartCommand,
    serviceStartTimeoutSeconds,
    skipPrompts,
    startServiceCwd,
    useTailscaleService,
}: Readonly<ParsedArgs<typeof initArgs>>) {
    return {
        serviceName: name || undefined,
        serviceOptions: {
            healthCheckTimeout: createSecondsDuration(healthCheckTimeoutSeconds),
            healthCheckUrl: healthCheckUrl || undefined,
            lockFilePath: lockFilePath ? resolve(lockFilePath) : undefined,
            logDirPath: logDirPath ? resolve(logDirPath) : undefined,
            servicePort: port === false ? undefined : port,
            serviceStartCommand: serviceStartCommand || undefined,
            serviceStartTimeout: createSecondsDuration(serviceStartTimeoutSeconds),
            startServiceCwd: startServiceCwd ? resolve(startServiceCwd) : undefined,
            useTailscaleService: useTailscaleService ? useTailscaleService === 'true' : undefined,
        },
        shouldOverwrite: overwrite,
        shouldSkipPrompts: skipPrompts,
    };
}

function isHttpUrl(text: string) {
    const protocol = wrapInTry(() => parseUrl(text).protocol, {
        fallbackValue: undefined,
    });
    return protocol === 'http' || protocol === 'https';
}

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

async function promptForText({
    defaultText,
    message,
    validate,
}: Readonly<{
    defaultText: string;
    message: string;
    validate?: ((text: string) => string | true) | undefined;
}>) {
    return (
        (
            await input({
                message: `${message} (${defaultText})`,
                ...(validate
                    ? {
                          validate(text) {
                              return text.trim() ? validate(text.trim()) : true;
                          },
                      }
                    : {}),
            })
        ).trim() || undefined
    );
}

async function promptForServiceOptions({
    isTailscaleSetByConfig,
    serviceName,
    serviceOptions,
    servicePort,
    shouldSkipPrompts,
}: Readonly<{
    isTailscaleSetByConfig: boolean;
    serviceName: string;
    serviceOptions: Readonly<PartialWithUndefined<ServiceOptions>>;
    servicePort: number;
    shouldSkipPrompts: boolean;
}>): Promise<Omit<ServiceOptions, 'servicePort'>> {
    const defaults = resolveServiceOptions({
        serviceName,
        serviceOptions: {
            servicePort,
        },
    });

    if (serviceOptions.healthCheckUrl && !isHttpUrl(serviceOptions.healthCheckUrl)) {
        throw new Error(
            `Health check URL '${serviceOptions.healthCheckUrl}' is not an http or https URL.`,
        );
    }

    return {
        ...omitObjectKeys(serviceOptions, ['servicePort']),
        serviceStartCommand:
            serviceOptions.serviceStartCommand ||
            (shouldSkipPrompts
                ? undefined
                : await promptForText({
                      defaultText: defaults.serviceStartCommand,
                      message: 'Command that starts this service',
                  })),
        startServiceCwd:
            serviceOptions.startServiceCwd ||
            (shouldSkipPrompts
                ? undefined
                : resolve(
                      (await promptForText({
                          defaultText: process.cwd(),
                          message: 'Directory to run that command from',
                      })) || process.cwd(),
                  )),
        healthCheckUrl:
            serviceOptions.healthCheckUrl ||
            (shouldSkipPrompts
                ? undefined
                : await promptForText({
                      defaultText: defaults.healthCheckUrl,
                      message: 'Health check URL',
                      validate(text) {
                          return isHttpUrl(text) || 'Enter an http or https URL.';
                      },
                  })),
        useTailscaleService:
            serviceOptions.useTailscaleService ??
            (shouldSkipPrompts || isTailscaleSetByConfig
                ? undefined
                : (await confirm({
                      message: 'Run this service as a Tailscale service?',
                      default: false,
                  })) || undefined),
    };
}

/**
 * Configure the current directory as a service and run ensure-service once per minute through a
 * cron, then log what changed. When the current directory is not already configured, prompts for
 * the service's name, port, start command, the directory to run it from, health check URL, and
 * `useTailscaleService` (blank answers leave them at their defaults). Each prompt is skipped when
 * its value is given, and every prompt is skipped when `shouldSkipPrompts` is set. The
 * `useTailscaleService` prompt is also skipped when the config sets it at the top level. The cron
 * runs the globally installed `ensure-service`, which this does not install.
 *
 * @category Main
 */
export async function runInit({
    serviceName,
    serviceOptions = {},
    shouldOverwrite,
    shouldSkipPrompts = false,
}: Readonly<
    PartialWithUndefined<{
        serviceName: string;
        serviceOptions: Readonly<PartialWithUndefined<ServiceOptions>>;
        shouldOverwrite: boolean;
        shouldSkipPrompts: boolean;
    }>
>) {
    const homePath = homedir();

    const configResult = await createEnsureServiceConfig({
        configPath: defaultConfigPath,
        cwd: process.cwd(),
        getServiceName(params) {
            return (
                serviceName ||
                (shouldSkipPrompts ? params.defaultName : promptForServiceName(params))
            );
        },
        getServiceOptions(params) {
            return promptForServiceOptions({
                ...params,
                serviceOptions,
                shouldSkipPrompts,
            });
        },
        getServicePort(params) {
            return (
                serviceOptions.servicePort ??
                (shouldSkipPrompts ? params.defaultPort : promptForServicePort(params))
            );
        },
        shouldOverwrite,
    });

    if (serviceName && configResult.serviceName !== serviceName) {
        throw new Error(
            `This directory is already configured as '${configResult.serviceName}'. Rename it in '${defaultConfigPath}' instead.`,
        );
    }

    await ensureTailscaleKeyFile(defaultTailscaleKeyFilePath);
    /** An invalid key file still needs filling in, so it gets the same message as an empty one. */
    const tailscaleOauthClient = await wrapInTry(
        () => readTailscaleOauthClient(defaultTailscaleKeyFilePath),
        {
            fallbackValue: undefined,
        },
    );
    await removeNonInteractiveBashGuard({
        bashrcPath: join(homePath, '.bashrc'),
    });
    const didChangeCron = await installEnsureServiceCron({
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
            ...(tailscaleOauthClient
                ? []
                : [
                      `To use Tailscale Services, fill in ${defaultTailscaleKeyFilePath}.`,
                  ]),
            ...(tailscaleOperatorCommand
                ? [
                      `To use Tailscale Services on this device, also run '${tailscaleOperatorCommand}' once.`,
                  ]
                : []),
            ...(didChangeCron
                ? [
                      'Configured ensure-service to run once per minute.',
                  ]
                : []),
        ].join('\n'),
    );
}
