import {assertWrap, check} from '@augment-vir/assert';
import {type AtLeastOneDuration, type Duration, type DurationUnit, convertDuration} from 'date-vir';
import {spawn} from 'node:child_process';
import {access, mkdir, open, rm, stat} from 'node:fs/promises';
import {dirname} from 'node:path';

/**
 * Check if an error is Node's `EEXIST` file system error.
 *
 * @category Internal
 */
export function isFileExistsError(error: unknown) {
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

/**
 * Create the command that shows a file in the platform's file explorer. macOS and Windows select
 * the file; other platforms open its directory with `xdg-open`.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * createRevealFileCommand({filePath: '/a/config.json', platform: 'darwin'}); // ['open', '-R', '/a/config.json']
 * ```
 */
export function createRevealFileCommand({
    filePath,
    platform,
}: Readonly<{
    filePath: string;
    platform: NodeJS.Platform;
}>) {
    const platformCommands: Partial<Record<NodeJS.Platform, string[]>> = {
        darwin: [
            'open',
            '-R',
            filePath,
        ],
        win32: [
            'explorer.exe',
            `/select,${filePath}`,
        ],
    };

    return (
        platformCommands[platform] || [
            'xdg-open',
            dirname(filePath),
        ]
    );
}

/**
 * Show a file in the current platform's file explorer without waiting for the explorer to close.
 *
 * @category Internal
 * @throws Error if the file does not exist.
 */
export async function revealFile(filePath: string) {
    try {
        await access(filePath);
    } catch (error) {
        if (isFileNotFoundError(error)) {
            throw new Error(`'${filePath}' does not exist.`, {
                cause: error,
            });
        }
        throw error;
    }

    const [
        command,
        ...args
    ] = createRevealFileCommand({
        filePath,
        platform: process.platform,
    });

    /** Arguments are passed without a shell so the path never needs quoting. */
    spawn(assertWrap.isDefined(command), args, {
        detached: true,
        stdio: 'ignore',
    }).unref();
}
