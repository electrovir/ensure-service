import {check} from '@augment-vir/assert';
import {readFile, writeFile} from 'node:fs/promises';

// cspell:word besac

type BashBlockRange = Readonly<{
    endIndex: number;
    startIndex: number;
}>;

function isBashComment(bashrcLine: string) {
    return /^[ \t]*#/.test(bashrcLine);
}

function isInteractiveGuardComment(bashrcLine: string) {
    return isBashComment(bashrcLine) && /interactive|PS1|\$-|prompt/i.test(bashrcLine);
}

function isBashGuardSyntax(bashrcLine: string) {
    return (
        bashrcLine.trim() === ';;' ||
        /^[ \t]*\*\)[ \t]*$/.test(bashrcLine) ||
        /\bthen[ \t]*$/.test(bashrcLine)
    );
}

function hasReturnOrExit(bashrcLines: ReadonlyArray<string>) {
    const firstBashStatement = bashrcLines.find((bashrcLine) => {
        return !!bashrcLine.trim() && !isBashComment(bashrcLine) && !isBashGuardSyntax(bashrcLine);
    });

    return (
        check.isDefined(firstBashStatement) &&
        (/^[ \t]*(?:return|exit)\b/.test(firstBashStatement) ||
            /(?:\*\)|\bthen\b)[ \t]*(?:return|exit)\b/.test(firstBashStatement))
    );
}

function getBashBlockStartIndex({
    bashrcLines,
    guardStartIndex,
}: Readonly<{
    bashrcLines: ReadonlyArray<string>;
    guardStartIndex: number;
}>) {
    const immediatelyPrecedingCommentsStartIndex =
        bashrcLines.slice(0, guardStartIndex).findLastIndex((bashrcLine) => {
            return !isBashComment(bashrcLine);
        }) + 1;
    const precedingComments = bashrcLines.slice(
        immediatelyPrecedingCommentsStartIndex,
        guardStartIndex,
    );
    const lastNonGuardCommentIndex = precedingComments.findLastIndex((bashrcLine) => {
        return !isInteractiveGuardComment(bashrcLine);
    });

    return immediatelyPrecedingCommentsStartIndex + lastNonGuardCommentIndex + 1;
}

function getBashBlockRange({
    bashrcLines,
    guardEndIndex,
    guardStartIndex,
}: Readonly<{
    bashrcLines: ReadonlyArray<string>;
    guardEndIndex: number;
    guardStartIndex: number;
}>): BashBlockRange {
    return {
        endIndex: guardEndIndex,
        startIndex: getBashBlockStartIndex({
            bashrcLines,
            guardStartIndex,
        }),
    };
}

function findNonInteractiveCaseGuard({
    bashrcLines,
    guardStartIndex,
}: Readonly<{
    bashrcLines: ReadonlyArray<string>;
    guardStartIndex: number;
}>) {
    const guardEndIndex = bashrcLines.findIndex((bashrcLine, bashrcLineIndex) => {
        return (
            bashrcLineIndex >= guardStartIndex &&
            !isBashComment(bashrcLine) &&
            /\besac\b/.test(bashrcLine)
        );
    });

    if (guardEndIndex === -1) {
        return undefined;
    }

    const guardLines = bashrcLines.slice(guardStartIndex, guardEndIndex + 1);
    const interactiveBranchIndex = guardLines.findIndex((bashrcLine) => {
        return /\*i\*\)/.test(bashrcLine);
    });
    const nonInteractiveBranchIndex = guardLines.findIndex((bashrcLine, bashrcLineIndex) => {
        return bashrcLineIndex >= interactiveBranchIndex && /(?:^|;)[ \t]*\*\)/.test(bashrcLine);
    });

    if (
        interactiveBranchIndex === -1 ||
        nonInteractiveBranchIndex === -1 ||
        !hasReturnOrExit(guardLines.slice(nonInteractiveBranchIndex))
    ) {
        return undefined;
    }

    return getBashBlockRange({
        bashrcLines,
        guardEndIndex,
        guardStartIndex,
    });
}

function isNonInteractiveIfCondition(ifConditionLines: ReadonlyArray<string>) {
    const checksShellOptions =
        ifConditionLines.some((bashrcLine) => {
            return bashrcLine.includes('$-');
        }) &&
        ifConditionLines.some((bashrcLine) => {
            return bashrcLine.includes('i');
        }) &&
        ifConditionLines.some((bashrcLine) => {
            return (
                bashrcLine.includes('!=') ||
                bashrcLine.includes('!~') ||
                /!\s*(?:\[\[?|\$-)/.test(bashrcLine)
            );
        });
    const checksPrompt = ifConditionLines.some((bashrcLine) => {
        return bashrcLine.includes('PS1') && bashrcLine.includes('-z');
    });

    return checksShellOptions || checksPrompt;
}

function findNonInteractiveIfGuard({
    bashrcLines,
    guardStartIndex,
}: Readonly<{
    bashrcLines: ReadonlyArray<string>;
    guardStartIndex: number;
}>) {
    const guardEndIndex = bashrcLines.findIndex((bashrcLine, bashrcLineIndex) => {
        return (
            bashrcLineIndex >= guardStartIndex &&
            !isBashComment(bashrcLine) &&
            /\bfi\b/.test(bashrcLine)
        );
    });

    if (guardEndIndex === -1) {
        return undefined;
    }

    const guardLines = bashrcLines.slice(guardStartIndex, guardEndIndex + 1);
    const thenIndex = guardLines.findIndex((bashrcLine) => {
        return !isBashComment(bashrcLine) && /\bthen\b/.test(bashrcLine);
    });

    if (
        thenIndex === -1 ||
        !isNonInteractiveIfCondition(guardLines.slice(0, thenIndex + 1)) ||
        !hasReturnOrExit(guardLines.slice(thenIndex))
    ) {
        return undefined;
    }

    return getBashBlockRange({
        bashrcLines,
        guardEndIndex,
        guardStartIndex,
    });
}

function getNonInteractiveBashGuardRanges(bashrcLines: ReadonlyArray<string>) {
    const caseGuardRanges = bashrcLines
        .map((bashrcLine, guardStartIndex) => {
            return /^[ \t]*case[ \t]+(?:\$-|["']\$-["'])(?:[ \t]|$)/.test(bashrcLine)
                ? findNonInteractiveCaseGuard({
                      bashrcLines,
                      guardStartIndex,
                  })
                : undefined;
        })
        .filter(check.isDefined);
    const ifGuardRanges = bashrcLines
        .map((bashrcLine, guardStartIndex) => {
            return /^[ \t]*if\b/.test(bashrcLine)
                ? findNonInteractiveIfGuard({
                      bashrcLines,
                      guardStartIndex,
                  })
                : undefined;
        })
        .filter(check.isDefined);

    return [
        ...caseGuardRanges,
        ...ifGuardRanges,
    ];
}

/**
 * Remove non-interactive Bash guards when they prevent cron from sourcing `.bashrc`.
 *
 * @category Internal
 */
export async function removeNonInteractiveBashGuard({
    bashrcPath,
}: Readonly<{
    bashrcPath: string;
}>) {
    try {
        const bashrcContents = await readFile(bashrcPath, 'utf8');
        const lineEnding = bashrcContents.includes('\r\n') ? '\r\n' : '\n';
        const bashrcLines = bashrcContents.split(lineEnding);
        const bashGuardRanges = getNonInteractiveBashGuardRanges(bashrcLines);
        const updatedBashrcContents = bashrcLines
            .map((bashrcLine, bashrcLineIndex) => {
                return bashGuardRanges.some(({endIndex, startIndex}) => {
                    return bashrcLineIndex >= startIndex && bashrcLineIndex <= endIndex;
                })
                    ? undefined
                    : bashrcLine;
            })
            .filter(check.isDefined)
            .join(lineEnding);

        if (updatedBashrcContents === bashrcContents) {
            return;
        }

        await writeFile(bashrcPath, updatedBashrcContents);
    } catch (error) {
        if (check.hasKey(error, 'code') && error.code === 'ENOENT') {
            return;
        }

        throw error;
    }
}
