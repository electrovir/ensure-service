import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {createTailscaleOperatorCommand} from './tailscale-operator.js';

describe(createTailscaleOperatorCommand.name, () => {
    it('returns a command until the user is the operator', () => {
        assert.deepEquals(
            [
                '{"ControlURL": "https://controlplane.tailscale.com"}',
                '{"OperatorUser": "someone-else"}',
                '{"OperatorUser": "example-user"}',
                'not json',
            ].map((preferencesJson) => {
                return createTailscaleOperatorCommand({
                    preferencesJson,
                    username: 'example-user',
                });
            }),
            [
                'sudo tailscale set --operator=example-user',
                'sudo tailscale set --operator=example-user',
                undefined,
                undefined,
            ],
        );
    });
});
