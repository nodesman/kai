// src/lib/typescript/services/test-runner/ITestRunnerService.ts
export interface TestResult {
  success: boolean;
  testName?: string;
  message?: string;
  error?: string;
  stackTrace?: string;
}

export interface SourceFileToCopy {
  originalPath: string;
  targetNameInTemp: string; // The desired name in the temp directory
}

export interface ITestRunnerService {
  /**
   * Runs a test.
   * @param testFileContent The string content of the test file.
   * @param testFileName The name for the temporary test file (e.g., 'temp.test.ts').
   * @param tempDirNamePrefix A prefix for the temporary directory name (e.g., 'agentic-tdd').
   * @param sourceFilesToCopy Optional array of source files to copy into the temp directory.
   * @param testName Optional specific test name to run within the test file.
   * @returns A promise that resolves to the test result.
   */
  runTest(
    testFileContent: string, 
    testFileName: string, 
    tempDirNamePrefix: string, 
    sourceFilesToCopy?: SourceFileToCopy[],
    testName?: string, 
  ): Promise<TestResult>;
}
