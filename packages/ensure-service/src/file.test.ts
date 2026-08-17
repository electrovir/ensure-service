import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {calculateRelativeDate, getNowInUtcTimezone, toJsDate} from 'date-vir';
import {access, mkdtemp, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acquireLock, isFileNewerThan, isFileOlderThan} from './file.js';

function createPastDate() {
    return toJsDate(
        calculateRelativeDate(getNowInUtcTimezone(), {
            seconds: -10,
        }),
    );
}

describe(isFileOlderThan.name, () => {
    it('returns true when a file is older than the given duration', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const filePath = join(temporaryDirectory, 'service.log');
        const fileModifiedAt = createPastDate();

        try {
            await writeFile(filePath, 'service output');
            await utimes(filePath, fileModifiedAt, fileModifiedAt);

            assert.isTrue(
                await isFileOlderThan(filePath, {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('returns false when a file is not yet old enough', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const filePath = join(temporaryDirectory, 'service.log');

        try {
            await writeFile(filePath, 'service output');

            assert.isFalse(
                await isFileOlderThan(filePath, {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('returns false when the file does not exist', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));

        try {
            assert.isFalse(
                await isFileOlderThan(join(temporaryDirectory, 'missing.log'), {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});

describe(isFileNewerThan.name, () => {
    it('returns true when a file is newer than the given duration', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const filePath = join(temporaryDirectory, 'service.log');

        try {
            await writeFile(filePath, 'service output');

            assert.isTrue(
                await isFileNewerThan(filePath, {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('returns false when a file is older than the given duration', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const filePath = join(temporaryDirectory, 'service.log');
        const fileModifiedAt = createPastDate();

        try {
            await writeFile(filePath, 'service output');
            await utimes(filePath, fileModifiedAt, fileModifiedAt);

            assert.isFalse(
                await isFileNewerThan(filePath, {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('returns false when the file does not exist', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));

        try {
            assert.isFalse(
                await isFileNewerThan(join(temporaryDirectory, 'missing.log'), {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});

describe(acquireLock.name, () => {
    it('creates a lock and prevents overlapping acquisition', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const lockPath = join(temporaryDirectory, 'locks', 'ensure.lock');

        try {
            assert.deepEquals(
                (
                    await Promise.all([
                        acquireLock(lockPath, {
                            seconds: 5,
                        }),
                        acquireLock(lockPath, {
                            seconds: 5,
                        }),
                    ])
                ).toSorted(),
                [
                    false,
                    true,
                ],
            );
            await assert.doesNotThrow(access(lockPath));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('replaces a stale lock', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const lockPath = join(temporaryDirectory, 'ensure.lock');
        const fileModifiedAt = createPastDate();

        try {
            await writeFile(lockPath, 'stale lock');
            await utimes(lockPath, fileModifiedAt, fileModifiedAt);

            assert.isTrue(
                await acquireLock(lockPath, {
                    seconds: 5,
                }),
            );
            assert.isTrue(
                await isFileNewerThan(lockPath, {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('propagates errors unrelated to an existing lock', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ensure-service-'));
        const lockDirectoryPath = join(temporaryDirectory, 'locks');
        const lockPath = join(lockDirectoryPath, 'ensure.lock');

        try {
            await writeFile(lockDirectoryPath, 'not a directory');

            await assert.throws(
                acquireLock(lockPath, {
                    seconds: 5,
                }),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
