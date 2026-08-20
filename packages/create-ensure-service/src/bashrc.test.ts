import {assert} from '@augment-vir/assert';
import {describe, it} from '@augment-vir/test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {removeNonInteractiveBashGuard} from './bashrc.js';

// cspell:word esac

describe(removeNonInteractiveBashGuard.name, () => {
    it('removes a non-interactive case guard on repeated runs while preserving other Bash configuration', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const bashrcPath = join(temporaryDirectory, '.bashrc');

        try {
            await writeFile(
                bashrcPath,
                [
                    'export PATH="$PATH:$HOME/bin"',
                    '# Only load the remaining setup for interactive shells.',
                    'case "$-" in',
                    '    *i*)',
                    '        ;;',
                    '    *)',
                    '        return 0',
                    '        ;;',
                    'esac',
                    '# Skip startup work outside an interactive terminal.',
                    'case $- in *i*) ;; *) exit ;; esac',
                    'alias service-logs="tail -f service.log"',
                    '',
                ].join('\n'),
            );

            await removeNonInteractiveBashGuard({
                bashrcPath,
            });
            await removeNonInteractiveBashGuard({
                bashrcPath,
            });

            assert.strictEquals(
                await readFile(bashrcPath, 'utf8'),
                [
                    'export PATH="$PATH:$HOME/bin"',
                    'alias service-logs="tail -f service.log"',
                    '',
                ].join('\n'),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('removes non-interactive if guards and their preceding comments', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const bashrcPath = join(temporaryDirectory, '.bashrc');

        try {
            await writeFile(
                bashrcPath,
                [
                    '# Shared shell settings.',
                    '# Stop here when Bash is running without an interactive prompt.',
                    'if [[ "$-" != *i* ]]; then',
                    '    return',
                    'fi',
                    '# Do not run the remaining commands without a prompt.',
                    'if [ -z "$PS1" ]; then',
                    '    exit',
                    'fi',
                    '# Keep this interactive-only setup.',
                    'if [[ "$-" == *i* ]]; then',
                    '    return',
                    'fi',
                    '',
                ].join('\n'),
            );

            await removeNonInteractiveBashGuard({
                bashrcPath,
            });

            assert.strictEquals(
                await readFile(bashrcPath, 'utf8'),
                [
                    '# Shared shell settings.',
                    '# Keep this interactive-only setup.',
                    'if [[ "$-" == *i* ]]; then',
                    '    return',
                    'fi',
                    '',
                ].join('\n'),
            );
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('preserves non-interactive blocks that do work before returning', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const bashrcPath = join(temporaryDirectory, '.bashrc');
        const bashrcContents = [
            '# Record non-interactive sessions for local diagnostics.',
            'if [[ "$-" != *i* ]]; then',
            String.raw`    printf "non-interactive shell\n"`,
            '    return',
            'fi',
            '# This case expression emits environment information.',
            'case "$-" in',
            String.raw`    *i*) printf "interactive shell\n" ;;`,
            String.raw`    *) printf "non-interactive shell\n" ;;`,
            'esac',
            '',
        ].join('\n');

        try {
            await writeFile(bashrcPath, bashrcContents);

            await removeNonInteractiveBashGuard({
                bashrcPath,
            });

            assert.strictEquals(await readFile(bashrcPath, 'utf8'), bashrcContents);
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('leaves an existing Bash configuration without a guard unchanged', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const bashrcPath = join(temporaryDirectory, '.bashrc');
        const bashrcContents = [
            '# Shell preferences.',
            'export EDITOR=vim',
            'alias ll="ls -alF"',
            '',
        ].join('\n');

        try {
            await writeFile(bashrcPath, bashrcContents);

            await removeNonInteractiveBashGuard({
                bashrcPath,
            });

            assert.strictEquals(await readFile(bashrcPath, 'utf8'), bashrcContents);
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });

    it('does not create a missing Bash configuration file', async () => {
        const temporaryDirectory = await mkdtemp(join(tmpdir(), 'create-ensure-service-'));
        const bashrcPath = join(temporaryDirectory, '.bashrc');

        try {
            await removeNonInteractiveBashGuard({
                bashrcPath,
            });

            await assert.throws(readFile(bashrcPath, 'utf8'));
        } finally {
            await rm(temporaryDirectory, {
                force: true,
                recursive: true,
            });
        }
    });
});
