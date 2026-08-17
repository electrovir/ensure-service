import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {assertValidPort} from './port.js';

describe(assertValidPort.name, () => {
    it('accepts valid port boundaries', () => {
        assert.doesNotThrow(() => {
            [
                1,
                65_535,
            ].forEach(assertValidPort);
        });
    });

    it('rejects ports outside the valid range', () => {
        assert.throws(
            () => {
                assertValidPort(0);
            },
            {
                matchMessage: 'valid port',
            },
        );
    });

    it('rejects non-integer ports', () => {
        assert.throws(
            () => {
                assertValidPort(1.5);
            },
            {
                matchMessage: 'integer',
            },
        );
    });
});
