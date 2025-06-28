export const TestCoveragePrompts = {
    generateTests: (
        filePath: string,
        fileContent: string,
        coverageInfo: string
    ): string => `You are an AI software engineer tasked with improving test coverage.\nFile: ${filePath}\nCurrent coverage info: ${coverageInfo}\nFile content:\n\`\`\`\n${fileContent}\n\`\`\`\nGenerate Jest tests to maximize coverage. Respond only with the test file content.`
};
