// cspell:word addrs

import {selectFrom} from '@augment-vir/common';
import {defineApi, defineEndpoint, HttpMethod, HttpStatus, RestVirClient} from '@rest-vir/api';
import {defineShape, nullableShape} from 'object-shape-tester';

/**
 * Shape for {@link TailscaleOauthKey}.
 *
 * @category Internal
 */
export const tailscaleOauthKeyShape = defineShape({
    clientId: '',
    /** Starts with `tskey-client-`. */
    clientSecret: '',
});

/**
 * Tailscale OAuth client key.
 *
 * @category Internal
 */
export type TailscaleOauthKey = typeof tailscaleOauthKeyShape.runtimeType;

/**
 * Shape of a Tailscale Service as returned by the Tailscale API.
 *
 * @category Internal
 */
export const tailscaleServiceShape = defineShape({
    /** Includes the `svc:` prefix. */
    name: '',
    addrs: nullableShape(['']),
    comment: nullableShape(''),
    displayName: nullableShape(''),
    /** `protocol:port` pairs, such as `tcp:443`. */
    ports: [''],
    tags: nullableShape(['']),
});

const authorizationHeader = {
    authorization: /^Bearer /,
};

/**
 * Exchange an OAuth client secret for an access token. Tailscale access tokens expire after one
 * hour.
 *
 * @category Internal
 */
export const tailscaleOauthTokenEndpoint = defineEndpoint({
    path: '/api/v2/oauth/token',
    requests: {
        [HttpMethod.Post]: {
            responses: {
                [HttpStatus.Ok]: {
                    responseData: defineShape({
                        access_token: '',
                    }),
                },
            },
        },
    },
});

/**
 * Read, create, or update a Tailscale Service in the access token's tailnet. `PUT` creates the
 * Service if it does not exist yet.
 *
 * @category Internal
 */
export const tailscaleServiceEndpoint = defineEndpoint({
    path: '/api/v2/tailnet/-/services/:serviceName',
    requests: {
        [HttpMethod.Get]: {
            requiredRequestHeaders: authorizationHeader,
            responses: {
                [HttpStatus.Ok]: {
                    responseData: tailscaleServiceShape,
                },
            },
        },
        [HttpMethod.Put]: {
            requiredRequestHeaders: authorizationHeader,
            requestData: tailscaleServiceShape,
            responses: {
                [HttpStatus.Ok]: {
                    responseData: tailscaleServiceShape,
                },
            },
        },
    },
});

/**
 * Approve (or revoke approval for) a device as a host of a Tailscale Service.
 *
 * @category Internal
 */
export const tailscaleServiceDeviceApprovalEndpoint = defineEndpoint({
    path: '/api/v2/tailnet/-/services/:serviceName/device/:deviceId/approved',
    requests: {
        [HttpMethod.Post]: {
            requiredRequestHeaders: authorizationHeader,
            requestData: defineShape({
                approved: false,
            }),
            responses: {
                [HttpStatus.Ok]: {
                    responseData: defineShape({
                        approved: false,
                    }),
                },
            },
        },
    },
});

/**
 * The subset of the Tailscale API that ensure-service uses.
 *
 * @category Internal
 */
export const tailscaleApi = defineApi({
    apiName: 'tailscale',
    endpoints: [
        tailscaleOauthTokenEndpoint,
        tailscaleServiceEndpoint,
        tailscaleServiceDeviceApprovalEndpoint,
    ],
    webSockets: [],
});

/**
 * A client for {@link tailscaleApi}.
 *
 * @category Internal
 */
export type TailscaleClient = RestVirClient<typeof tailscaleApi>;

/**
 * Create a client for {@link tailscaleApi}.
 *
 * @category Internal
 */
export function createTailscaleClient(baseUrl = 'https://api.tailscale.com') {
    return new RestVirClient(tailscaleApi, baseUrl);
}

/**
 * Trade a Tailscale OAuth client for a Tailscale API access token.
 *
 * @category Internal
 * @throws Error if Tailscale rejects the secret.
 */
export async function fetchTailscaleAccessToken({
    client,
    oauthKey,
}: Readonly<{
    client: Readonly<TailscaleClient>;
    oauthKey: Readonly<TailscaleOauthKey>;
}>) {
    const result = await client.fetch(tailscaleOauthTokenEndpoint).POST({
        options: {
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        },
        requestData: new URLSearchParams({
            client_id: oauthKey.clientId,
            client_secret: oauthKey.clientSecret,
            grant_type: 'client_credentials',
        }),
    });

    if (result.Ok) {
        return result.Ok.responseData.access_token;
    }

    throw new Error(
        `Failed to get a Tailscale access token (HTTP ${result.unexpectedError.status}). Check the OAuth client ID and secret.`,
    );
}

/**
 * Create a Tailscale Service, or add HTTPS (`tcp:443`) to an existing one's ports. The existing
 * Service's other fields are kept, since `PUT` replaces every field.
 *
 * @category Internal
 * @throws Error if Tailscale rejects either request.
 */
export async function upsertTailscaleService({
    accessToken,
    client,
    tailscaleServiceName,
}: Readonly<{
    accessToken: string;
    client: Readonly<TailscaleClient>;
    /** Includes the `svc:` prefix. */
    tailscaleServiceName: string;
}>) {
    const requiredHeaders = {
        authorization: `Bearer ${accessToken}`,
    };
    const existing = await client.fetch(tailscaleServiceEndpoint).GET({
        requiredHeaders,
        pathParams: {
            serviceName: tailscaleServiceName,
        },
    });

    if (!existing.Ok && existing.unexpectedError.status !== HttpStatus.NotFound) {
        throw new Error(
            `Failed to read Tailscale Service ${tailscaleServiceName} (HTTP ${existing.unexpectedError.status}).`,
        );
    } else if (existing.Ok?.responseData.ports.includes('tcp:443')) {
        return;
    }

    const updated = await client.fetch(tailscaleServiceEndpoint).PUT({
        requiredHeaders,
        pathParams: {
            serviceName: tailscaleServiceName,
        },
        requestData: {
            ...(existing.Ok
                ? selectFrom(existing.Ok.responseData, {
                      addrs: true,
                      comment: true,
                      displayName: true,
                      tags: true,
                  })
                : {}),
            name: tailscaleServiceName,
            ports: [
                ...(existing.Ok?.responseData.ports ?? []),
                'tcp:443',
            ],
        },
    });

    if (!updated.Ok) {
        throw new Error(
            `Failed to save Tailscale Service ${tailscaleServiceName} (HTTP ${updated.unexpectedError.status}).`,
        );
    }
}

/**
 * Approve a device as a host of a Tailscale Service. Approving an already approved device is a
 * no-op.
 *
 * @category Internal
 * @throws Error if Tailscale rejects the request.
 */
export async function approveTailscaleServiceHost({
    accessToken,
    client,
    deviceId,
    tailscaleServiceName,
}: Readonly<{
    accessToken: string;
    client: Readonly<TailscaleClient>;
    /** The device's stable node ID. */
    deviceId: string;
    /** Includes the `svc:` prefix. */
    tailscaleServiceName: string;
}>) {
    const result = await client.fetch(tailscaleServiceDeviceApprovalEndpoint).POST({
        requiredHeaders: {
            authorization: `Bearer ${accessToken}`,
        },
        pathParams: {
            deviceId,
            serviceName: tailscaleServiceName,
        },
        requestData: {
            approved: true,
        },
    });

    if (!result.Ok?.responseData.approved) {
        throw new Error(
            [
                `Failed to approve this device as a host of Tailscale Service ${tailscaleServiceName}`,
                result.Ok ? '.' : ` (HTTP ${result.unexpectedError.status}).`,
            ].join(''),
        );
    }
}
