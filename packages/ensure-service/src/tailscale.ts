import {
    ensureErrorAndPrependMessage,
    log,
    wrapInTry,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {convertDuration} from 'date-vir';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {chmod, mkdir, stat, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {checkValidShape, defineShape, readJsonWithShape, recordShape} from 'object-shape-tester';
import {defaultEnsureLogConfigPath, serviceNameShape, type Service} from './config.js';
import {isFileExistsError} from './file.js';
import {isTlsServer} from './service.js';
import {
    approveTailscaleServiceHost,
    createTailscaleClient,
    fetchTailscaleAccessToken,
    tailscaleOauthKeyShape,
    upsertTailscaleService,
    type TailscaleClient,
} from './tailscale-api.js';
import {createTailscaleCli, type TailscaleCli} from './tailscale-cli.js';

/**
 * Default path of the JSON file holding the Tailscale OAuth client ID and secret.
 *
 * @category Internal
 */
export const defaultTailscaleKeyFilePath = join(defaultEnsureLogConfigPath, 'tailscale-key.json');

/**
 * Default path of the file recording when each service's Tailscale setup was last checked. Delete
 * it to check every service on the next run.
 *
 * @category Internal
 */
export const defaultTailscaleProgressFilePath = join(
    defaultEnsureLogConfigPath,
    'tailscale-progress.json',
);

const tailscaleProgressShape = defineShape(
    recordShape({
        keys: serviceNameShape,
        /** Milliseconds since the epoch. */
        values: 0,
    }),
);

/**
 * Create the Tailscale key file with empty values if it does not exist, and make it readable only
 * by its owner.
 *
 * @category Internal
 * @throws Error if the file's permissions cannot be restricted to its owner.
 */
export async function ensureTailscaleKeyFile(keyFilePath: string) {
    await mkdir(dirname(keyFilePath), {
        recursive: true,
    });

    try {
        await writeFile(
            keyFilePath,
            JSON.stringify(tailscaleOauthKeyShape.default, undefined, 4) + '\n',
            {
                flag: 'wx',
                mode: 0o600,
            },
        );
    } catch (error) {
        if (!isFileExistsError(error)) {
            throw error;
        }
    }

    if (await isReadableByOthers(keyFilePath)) {
        try {
            await chmod(keyFilePath, 0o600);
        } catch (error) {
            throw ensureErrorAndPrependMessage(
                error,
                `Failed to restrict permissions on '${keyFilePath}'.`,
            );
        }

        if (await isReadableByOthers(keyFilePath)) {
            throw new Error(`Failed to restrict permissions on '${keyFilePath}'.`);
        }
    }
}

/**
 * Read the Tailscale OAuth client from the key file after running {@link ensureTailscaleKeyFile}.
 *
 * @category Internal
 * @returns The client, or `undefined` if its ID or secret is empty.
 * @throws Error if the file's permissions cannot be restricted to its owner or if the file does not
 *   match {@link tailscaleOauthKeyShape}.
 */
export async function readTailscaleOauthClient(keyFilePath: string) {
    await ensureTailscaleKeyFile(keyFilePath);

    const oauthClient = await readJsonWithShape(keyFilePath, tailscaleOauthKeyShape);

    return oauthClient.clientId && oauthClient.clientSecret ? oauthClient : undefined;
}

/**
 * Create a function that reads the key file and fetches a Tailscale access token on its first call.
 * Every later call returns that same token, or the same failure. Pass one to every
 * {@link ensureTailscaleService} call in a run so they share a single token.
 *
 * @category Internal
 */
export function createTailscaleAccessTokenGetter({
    client = createTailscaleClient(),
    keyFilePath = defaultTailscaleKeyFilePath,
}: Readonly<
    PartialWithUndefined<{
        client: Readonly<TailscaleClient>;
        keyFilePath: string;
    }>
> = {}) {
    /** Assigned on first call so no token is fetched when no service is due for a check. */
    let accessTokenPromise: Promise<string> | undefined;

    return () => {
        accessTokenPromise ??= fetchKeyFileAccessToken({
            client,
            keyFilePath,
        });

        return accessTokenPromise;
    };
}

async function fetchKeyFileAccessToken({
    client,
    keyFilePath,
}: Readonly<{
    client: Readonly<TailscaleClient>;
    keyFilePath: string;
}>) {
    const oauthClient = await readTailscaleOauthClient(keyFilePath);

    if (!oauthClient) {
        throw new Error(
            `No Tailscale OAuth client found. Fill in its clientId and clientSecret in '${keyFilePath}'.`,
        );
    }

    return await fetchTailscaleAccessToken({
        client,
        oauthKey: oauthClient,
    });
}

async function isReadableByOthers(filePath: string) {
    return !!((await stat(filePath)).mode & 0o077);
}

/**
 * Publish one service as the Tailscale Service `svc:<serviceName>`, served over HTTPS on port 443
 * by this device, unless it does not use Tailscale or was checked recently. A failed check counts
 * as a check, so it is not retried until the next interval. Failures are logged instead of thrown
 * so they do not affect the service itself.
 *
 * @category Internal
 * @returns Whether the service's Tailscale setup was checked.
 */
export async function ensureTailscaleService({
    client = createTailscaleClient(),
    getAccessToken = createTailscaleAccessTokenGetter({
        client,
    }),
    progressFilePath = defaultTailscaleProgressFilePath,
    service,
    serviceName,
    tailscaleCli = createTailscaleCli(),
}: Readonly<
    {
        service: Readonly<Service>;
        serviceName: string;
    } & PartialWithUndefined<{
        client: Readonly<TailscaleClient>;
        /** Created with {@link createTailscaleAccessTokenGetter}. */
        getAccessToken: () => Promise<string>;
        progressFilePath: string;
        tailscaleCli: Readonly<TailscaleCli>;
    }>
>) {
    if (!service.useTailscaleService) {
        return false;
    }

    const lastChecked = (await readTailscaleProgress(progressFilePath))[serviceName];

    if (
        lastChecked != undefined &&
        Date.now() - lastChecked <
            convertDuration(
                {
                    minutes: 30,
                },
                {
                    milliseconds: true,
                },
            ).milliseconds
    ) {
        return false;
    }

    try {
        const accessToken = await getAccessToken();
        const tailscaleServiceName = `svc:${serviceName}`;

        await upsertTailscaleService({
            accessToken,
            client,
            tailscaleServiceName,
        });
        await tailscaleCli.serveService({
            tailscaleServiceName,
            /**
             * `https+insecure` because a local HTTPS service's certificate is rarely publicly
             * trusted.
             */
            target:
                service.healthCheckUrl.toLowerCase().startsWith('https:') ||
                (await isTlsServer({
                    hostname: 'localhost',
                    port: service.servicePort,
                    timeout: service.healthCheckTimeout,
                }))
                    ? `https+insecure://localhost:${service.servicePort}`
                    : `http://localhost:${service.servicePort}`,
        });
        await approveTailscaleServiceHost({
            accessToken,
            client,
            deviceId: await tailscaleCli.readDeviceId(),
            tailscaleServiceName,
        });
    } catch (error) {
        log.error(
            ensureErrorAndPrependMessage(error, `Skipped Tailscale setup for ${serviceName}.`),
        );
        return false;
    } finally {
        recordTailscaleCheck({
            progressFilePath,
            serviceName,
        });
    }

    return true;
}

async function readTailscaleProgress(
    progressFilePath: string,
): Promise<Partial<Record<string, number>>> {
    return await wrapInTry(() => readJsonWithShape(progressFilePath, tailscaleProgressShape), {
        fallbackValue: {},
    });
}

/**
 * Services are checked in parallel and share one progress file. Synchronous file access keeps each
 * read-merge-write from interleaving with another service's, which would drop its timestamp.
 */
function recordTailscaleCheck({
    progressFilePath,
    serviceName,
}: Readonly<{
    progressFilePath: string;
    serviceName: string;
}>) {
    const progress: unknown = wrapInTry(
        () => JSON.parse(readFileSync(progressFilePath, 'utf8')) as unknown,
        {
            fallbackValue: {},
        },
    );

    mkdirSync(dirname(progressFilePath), {
        recursive: true,
    });
    writeFileSync(
        progressFilePath,
        JSON.stringify(
            {
                ...(checkValidShape(progress, tailscaleProgressShape) ? progress : {}),
                [serviceName]: Date.now(),
            },
            undefined,
            4,
        ) + '\n',
    );
}
