import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {fetchTailscaleAccessToken} from './tailscale-api.js';
import {createMockTailscaleHost} from './tailscale-api.mock.js';

describe(fetchTailscaleAccessToken.name, () => {
    it('trades the OAuth client for an access token', async () => {
        const mockTailscaleHost = createMockTailscaleHost();

        const accessToken = await fetchTailscaleAccessToken({
            client: mockTailscaleHost.client,
            oauthKey: mockTailscaleHost.oauthClient,
        });

        assert.deepEquals(mockTailscaleHost.issuedAccessTokens, [
            accessToken,
        ]);
    });

    it('rejects a wrong client secret', async () => {
        const mockTailscaleHost = createMockTailscaleHost();

        await assert.throws(
            fetchTailscaleAccessToken({
                client: mockTailscaleHost.client,
                oauthKey: {
                    ...mockTailscaleHost.oauthClient,
                    clientSecret: 'tskey-client-wrong',
                },
            }),
            {
                matchMessage: 'HTTP 401',
            },
        );
    });
});
