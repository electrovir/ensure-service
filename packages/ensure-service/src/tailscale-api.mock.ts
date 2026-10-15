// cspell:word addrs cntrl

import {assertWrap, check} from '@augment-vir/assert';
import {createArray, randomInteger, randomString} from '@augment-vir/common';
import {createMockHost, HttpMethod, HttpStatus} from '@rest-vir/api';
import {
    tailscaleApi,
    tailscaleOauthTokenEndpoint,
    tailscaleServiceDeviceApprovalEndpoint,
    tailscaleServiceEndpoint,
    type TailscaleOauthKey,
    type tailscaleServiceShape,
} from './tailscale-api.js';
import {type TailscaleCli} from './tailscale-cli.js';

/**
 * Create an in-memory Tailscale API and `tailscale` CLI that only accept a randomly generated OAuth
 * client and access tokens the mock issued.
 *
 * @returns The client and CLI to pass to code under test, the OAuth client the mock accepts, and
 *   the mock's recorded state.
 */
export function createMockTailscaleHost() {
    const oauthClient: TailscaleOauthKey = {
        clientId: randomString(12),
        clientSecret: `tskey-client-${randomString(12)}-${randomString(32)}`,
    };
    const deviceId = `n${randomString(12)}CNTRL`;
    const issuedAccessTokens: string[] = [];
    const tailscaleServices: Record<string, typeof tailscaleServiceShape.runtimeType> = {};
    const approvedHosts: {
        deviceId: string;
        tailscaleServiceName: string;
    }[] = [];
    const servedServices: Parameters<TailscaleCli['serveService']>[0][] = [];

    function isAuthorized(authorization: unknown) {
        return issuedAccessTokens.some((accessToken) => {
            return authorization === `Bearer ${accessToken}`;
        });
    }

    const unauthorized = {
        [HttpStatus.Unauthorized]: {
            responseData: undefined,
        },
    };
    const notFound = {
        [HttpStatus.NotFound]: {
            responseData: undefined,
        },
    };

    const client = createMockHost(tailscaleApi, {
        endpoints: {
            [tailscaleOauthTokenEndpoint.path]: {
                [HttpMethod.Post]({requestData}) {
                    const tokenRequest = new URLSearchParams(
                        check.isString(requestData) ? requestData : '',
                    );

                    if (
                        tokenRequest.get('grant_type') !== 'client_credentials' ||
                        tokenRequest.get('client_id') !== oauthClient.clientId ||
                        tokenRequest.get('client_secret') !== oauthClient.clientSecret
                    ) {
                        return unauthorized;
                    }

                    const accessToken = `tskey-api-${randomString(12)}-${randomString(32)}`;
                    issuedAccessTokens.push(accessToken);

                    return {
                        [HttpStatus.Ok]: {
                            responseData: {
                                access_token: accessToken,
                            },
                        },
                    };
                },
            },
            [tailscaleServiceEndpoint.path]: {
                [HttpMethod.Get]({pathParams, requestHeaders}) {
                    if (!isAuthorized(requestHeaders.authorization)) {
                        return unauthorized;
                    }

                    const tailscaleService =
                        tailscaleServices[assertWrap.isDefined(pathParams?.serviceName)];

                    return tailscaleService
                        ? {
                              [HttpStatus.Ok]: {
                                  responseData: tailscaleService,
                              },
                          }
                        : notFound;
                },
                [HttpMethod.Put]({pathParams, requestHeaders, requestData}) {
                    if (!isAuthorized(requestHeaders.authorization)) {
                        return unauthorized;
                    }

                    const serviceName = assertWrap.isDefined(pathParams?.serviceName);
                    const tailscaleService = {
                        ...requestData,
                        addrs:
                            tailscaleServices[serviceName]?.addrs ??
                            createRandomTailscaleAddresses(),
                    };
                    tailscaleServices[serviceName] = tailscaleService;

                    return {
                        [HttpStatus.Ok]: {
                            responseData: tailscaleService,
                        },
                    };
                },
            },
            [tailscaleServiceDeviceApprovalEndpoint.path]: {
                [HttpMethod.Post]({pathParams, requestHeaders, requestData}) {
                    const serviceName = assertWrap.isDefined(pathParams?.serviceName);

                    if (!isAuthorized(requestHeaders.authorization)) {
                        return unauthorized;
                    } else if (
                        !tailscaleServices[serviceName] ||
                        pathParams?.deviceId !== deviceId
                    ) {
                        return notFound;
                    }

                    approvedHosts.push({
                        deviceId,
                        tailscaleServiceName: serviceName,
                    });

                    return {
                        [HttpStatus.Ok]: {
                            responseData: requestData,
                        },
                    };
                },
            },
        },
    });

    const tailscaleCli: TailscaleCli = {
        readDeviceId() {
            return Promise.resolve(deviceId);
        },
        readServiceTarget({tailscaleServiceName}) {
            return Promise.resolve(
                servedServices.findLast((servedService) => {
                    return servedService.tailscaleServiceName === tailscaleServiceName;
                })?.target,
            );
        },
        serveService(params) {
            servedServices.push(params);
            return Promise.resolve();
        },
    };

    return {
        approvedHosts,
        client,
        deviceId,
        issuedAccessTokens,
        oauthClient,
        servedServices,
        tailscaleCli,
        tailscaleServices,
    };
}

/** Create a random Tailscale-range IPv4 and IPv6 address pair, as a Tailscale Service's `addrs`. */
export function createRandomTailscaleAddresses() {
    const ipv4 = [
        100,
        randomInteger({
            min: 64,
            max: 127,
        }),
        ...createArray(2, () => {
            return randomInteger({
                min: 0,
                max: 255,
            });
        }),
    ].join('.');
    const ipv6 = [
        'fd7a:115c:a1e0:',
        randomInteger({
            min: 0,
            max: 0xff_ff,
        }).toString(16),
    ].join(':');

    return [
        ipv4,
        ipv6,
    ];
}
