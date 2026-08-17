import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {checkValidShape} from 'object-shape-tester';
import {configOptionsShape, defaultConfig} from './config.js';

describe('configOptionsShape', () => {
    it('accepts default and partial configurations', () => {
        assert.deepEquals(
            [
                checkValidShape(defaultConfig, configOptionsShape),
                checkValidShape(
                    {
                        servicePort: 4000,
                    },
                    configOptionsShape,
                ),
            ],
            [
                true,
                true,
            ],
        );
    });

    it('rejects invalid option types', () => {
        assert.isFalse(
            checkValidShape(
                {
                    healthCheckTimeout: 'one second',
                },
                configOptionsShape,
            ),
        );
    });
});
