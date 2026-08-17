import {assert} from '@augment-vir/assert';

/**
 * Assert that a port is a valid TCP or UDP port number.
 *
 * @category Internal
 */
export function assertValidPort(port: number) {
    assert.isInteger(port, 'The server port must be an integer.');
    assert.isInBounds(
        port,
        {
            min: 1,
            max: 65_535,
        },
        'The server port must be a valid port number, between 1 and 65,535.',
    );
}
