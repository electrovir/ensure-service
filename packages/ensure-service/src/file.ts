import {check} from '@augment-vir/assert';
import {type AtLeastOneDuration, type Duration, type DurationUnit, convertDuration} from 'date-vir';
import {mkdir, open, rm, stat} from 'node:fs/promises';
import {dirname} from 'node:path';

function isFileExistsError(error: unknown) {
    return check.hasKey(error, 'code') && error.code === 'EEXIST';
}

function isFileNotFoundError(error: unknown) {
    return check.hasKey(error, 'code') && error.code === 'ENOENT';
}

async function getFileAge(path: string): Promise<Duration<DurationUnit.Milliseconds> | undefined> {
    try {
        const fileStats = await stat(path);

        return {
            milliseconds: Date.now() - fileStats.mtimeMs,
        };
    } catch (error) {
        if (isFileNotFoundError(error)) {
            return undefined;
        } else {
            throw error;
        }
    }
}

/**
 * Check if the file contained at the given file path is older than the given `duration`. If the
 * file does not exist, this returns `false`.
 *
 * @category Internal
 * @returns `true` if file exists and is older than the given duration. `false` if the file does not
 *   exist or is not older than the given duration.
 */
export async function isFileOlderThan(
    path: string,
    duration: Readonly<AtLeastOneDuration>,
): Promise<boolean> {
    const fileAge = await getFileAge(path);

    if (fileAge == undefined) {
        return false;
    } else {
        return (
            fileAge.milliseconds >
            convertDuration(duration, {
                milliseconds: true,
            }).milliseconds
        );
    }
}

/**
 * Check if the file or directory at the given path exists and is newer than the given duration.
 *
 * @category Internal
 */
export async function isFileNewerThan(
    path: string,
    duration: Readonly<AtLeastOneDuration>,
): Promise<boolean> {
    const fileAge = await getFileAge(path);

    if (fileAge == undefined) {
        return false;
    } else {
        return (
            fileAge.milliseconds <
            convertDuration(duration, {
                milliseconds: true,
            }).milliseconds
        );
    }
}

/**
 * Create the lock file exclusively, clearing it first if a previous run died holding it.
 *
 * @category Internal
 */
export async function acquireLock(
    lockPath: string,
    timeout: Readonly<AtLeastOneDuration>,
): Promise<boolean> {
    async function innerAcquireLock() {
        await mkdir(dirname(lockPath), {
            recursive: true,
        });
        const handle = await open(lockPath, 'wx');
        await handle.close();
        return true;
    }

    try {
        return await innerAcquireLock();
    } catch (error) {
        if (!isFileExistsError(error)) {
            throw error;
        } else if (await isFileOlderThan(lockPath, timeout)) {
            await rm(lockPath, {
                force: true,
            });

            return await innerAcquireLock();
        } else {
            return false;
        }
    }
}
