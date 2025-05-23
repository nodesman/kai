import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { TestResult, ITestRunnerService, SourceFileToCopy } from './ITestRunnerService';

export class TestRunnerService implements ITestRunnerService {
  public async runTest(
    testFileContent: string,
    testFileName: string,
    tempDirNamePrefix: string,
    sourceFilesToCopy?: SourceFileToCopy[],
    testName?: string,
  ): Promise<TestResult> {
    let tempDir: string | undefined;
    try {
      // Create a unique temporary directory
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), tempDirNamePrefix + '-'));
      console.log(`Created temporary directory for test run: ${tempDir}`);

      const absoluteTestFilePath = path.join(tempDir, testFileName);

      // Copy source files
      if (sourceFilesToCopy) {
        for (const fileToCopy of sourceFilesToCopy) {
          try {
            const sourceContent = await fs.readFile(fileToCopy.originalPath, 'utf-8');
            const targetPath = path.join(tempDir, fileToCopy.targetNameInTemp);
            await fs.writeFile(targetPath, sourceContent, 'utf-8');
            console.log(`Copied source file ${fileToCopy.originalPath} to ${targetPath}`);
          } catch (copyError: any) {
            console.error(`Error copying source file ${fileToCopy.originalPath}: ${copyError.message}`);
            // Depending on requirements, might re-throw or collect errors
            throw new Error(`Failed to copy source file ${fileToCopy.originalPath} to temp directory.`);
          }
        }
      }

      // Write the test file content to the temporary directory
      await fs.writeFile(absoluteTestFilePath, testFileContent, 'utf-8');
      console.log(`Test file written to ${absoluteTestFilePath}`);

      // For debugging: Log contents of the temporary directory
      const filesInTempDir = await fs.readdir(tempDir);
      console.log(`Contents of temporary directory ${tempDir}:`, filesInTempDir.join(', '));

      // Execute Jest
      // CWD is tempDir, so Jest resolves relative imports from there.
      // Using the project's main jest.config.js for ts-jest preset and other global settings.
      const projectRoot = path.resolve('/app'); // Assuming project root is /app
      const jestConfigPath = path.join(projectRoot, 'jest.config.js');
      
      // Removed -t testName filter to simplify; the file should only contain the relevant test.
      let command = `npx jest ${testFileName} --config ${jestConfigPath} --passWithNoTests`;

      console.log(`Executing test command: ${command} (CWD: ${tempDir}) for test file: ${testFileName}`);

      return await new Promise<TestResult>((resolve) => {
        exec(command, { cwd: tempDir }, (error, stdout, stderr) => {
          const output = stdout + stderr; // Combine for easier parsing

          if (error) { // Non-zero exit code
            console.error(`Jest execution error or test failure for ${testFileName} in ${tempDir}:`, error);
            console.error('stderr:', stderr);
            console.log('stdout (on error/failure):', stdout);
            resolve({
              success: false,
              testName: testName,
              message: `Test execution failed or tests did not pass for ${testName ? `'${testName}' in ` : ''}${testFileName}.\nstdout: ${stdout}\nstderr: ${stderr}`,
              error: stderr || error.message || "Jest command failed.",
              stackTrace: error.stack,
            });
            return;
          }
          
          console.log(`Jest execution completed (exit code 0) for ${testFileName} in ${tempDir}:`);
          console.log('stdout:', stdout);
          if (stderr && stderr.trim() !== "") {
              console.warn('stderr (on exit code 0, should ideally be empty or only warnings):', stderr);
          }

          if (output.includes("No tests found") || /Tests: {2}0 total/.test(output)) {
             resolve({
                success: false, 
                testName: testName,
                message: `Jest reported no tests found for ${testFileName}.\nstdout: ${stdout}`,
                error: "No tests found.",
             });
          } else if (/FAIL/.test(output) || /Test Suites: \d+ failed/.test(output) || /Tests:      \d+ failed/.test(output)) {
            resolve({
                success: false,
                testName: testName,
                message: `Jest tests failed for ${testFileName}.\nstdout: ${stdout}\nstderr: ${stderr}`,
                error: stderr || "Tests failed based on stdout.",
            });
          } else if (/PASS/.test(output) || /Test Suites: \d+ passed/.test(output) || /Tests:      \d+ passed/.test(output)) {
            resolve({
              success: true,
              testName: testName,
              message: `Test ${testName ? `'${testName}' in ` : ''}${testFileName} passed. Output:\n${stdout}`,
            });
          } else {
             resolve({
                success: false, 
                testName: testName,
                message: `Jest execution for ${testFileName} had unclear results (exit code 0 but no clear pass/fail/no tests found in output).\nstdout: ${stdout}\nstderr: ${stderr}`,
                error: stderr || "Unclear test outcome despite exit code 0.",
             });
          }
        });
      });
    } catch (e: any) {
      console.error(`Error in TestRunnerService runTest: ${e.message}`);
      return {
        success: false,
        testName: testName,
        message: `An unexpected error occurred in TestRunnerService. Error: ${e.message}`,
        error: e.message,
        stackTrace: e.stack,
      };
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          console.log(`Successfully deleted temporary directory: ${tempDir}`);
        } catch (rmError: any) {
          console.warn(`Failed to delete temporary directory ${tempDir}: ${rmError.message}`);
        }
      }
    }
  }
}
