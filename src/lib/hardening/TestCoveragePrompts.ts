export const TestCoveragePrompts = {
    generateTests: (
        filePath: string,
        fileContent: string,
        coverageInfo: string
    ): string => `You are an AI software engineer tasked with improving test coverage.\nFile: ${filePath}\nCurrent coverage info: ${coverageInfo}\nFile content:\n\`\`\`\n${fileContent}\n\`\`\`\nGenerate Jest tests to maximize coverage. Respond only with the test file content.`,

    generateTestDiff: (
        testPath: string,
        testContent: string,
        coverageInfo: string
    ): string =>
        `You are an AI software engineer tasked with improving test coverage.\nCurrent coverage info: ${coverageInfo}\nExisting test file ${testPath}:\n\`\`\`\n${testContent}\n\`\`\`\nProvide a unified diff patch for ${testPath} that adds one or more Jest tests to increase coverage. Respond only with the diff.`
};
