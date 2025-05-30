import * as path from 'path';
import { Specification, TestScenario } from '../../types/specification';
import { ITestRunnerService, SourceFileToCopy, TestResult } from '../test-runner/ITestRunnerService'; 
import { ITestOutputParser, ParsedErrorDetails } from '../test-parser/JestOutputParser';
import { IAiModelService } from '../ai-model/IAiModelService';
import { IFileSystemService } from '../file-system/IFileSystemService'; 

// Define AiFixResponse interface within the class or globally if preferred
interface AiFixResponse {
  filePathToModify: string;
  codeOrDiffContent: string;
  type: 'full_content' | 'diff';
}

export class AgenticTddService {
  private readonly testRunnerService: ITestRunnerService;
  private readonly outputParser: ITestOutputParser;
  private readonly aiModelService: IAiModelService;
  private readonly fileSystemService: IFileSystemService; 

  constructor(
    testRunnerService: ITestRunnerService,
    outputParser: ITestOutputParser,
    aiModelService: IAiModelService,
    fileSystemService: IFileSystemService, 
  ) {
    this.testRunnerService = testRunnerService;
    this.outputParser = outputParser;
    this.aiModelService = aiModelService;
    this.fileSystemService = fileSystemService; 
  }

  private async callAiToGenerateTestCode(specification: Specification, scenario: TestScenario, copiedFileTargetNames: string[]): Promise<string> {
    const systemMessage = "You are an expert TypeScript and Jest test generation assistant. Generate a complete Jest test script based on the provided scenario. Ensure the test initially fails if the described functionality is not present. The test will be run in a temporary directory where specified source files (like those listed) are copied. Therefore, use relative imports for these source files (e.g., `import { MyClass } from './myClassFileName.ts';` if 'myClassFileName.ts' is the target name of a copied source file). Output only the TypeScript code for the test.";
    const userPrompt = `Generate a Jest test for the following scenario:
Scenario Description: ${scenario.description}
Focus Area: ${scenario.focusArea}
Specification Context: ${specification.featureDescription}
Target names of source files that will be copied to the test directory (use relative imports for these): ${copiedFileTargetNames.join(', ')}`;

    console.log(`AI: Generating test code for scenario: "${scenario.description}" with target source file names: ${copiedFileTargetNames.join(', ')}`);
    return this.aiModelService.prompt(systemMessage, userPrompt, { ...scenario, copiedFileTargetNames });
  }

  private async callAiToAnalyzeFailure(
    _specification: Specification, // specification parameter was unused
    scenario: TestScenario,
    parsedError: ParsedErrorDetails,
  ): Promise<string> {
    const systemMessage = "You are an expert software diagnostics assistant. Analyze the following test failure details and provide a concise explanation of the likely cause, referencing the specification and code. Identify the specific function or logic that needs to change.";
    const userPrompt = `Diagnose the following Jest test failure:
Test Name: ${parsedError.testName}
Error Message: ${parsedError.errorMessage}
File Path: ${parsedError.filePath || 'N/A'}:${parsedError.lineNumber || 'N/A'}
Raw Error Output: ${parsedError.rawError}
Relevant Test Scenario: ${scenario.description}
Focus Area: ${scenario.focusArea}
Specification Context: []`; // Removed specification.featureDescription as it might be too large or not directly relevant for pure diagnosis

    console.log(`AI: Analyzing test failure for "${scenario.description}"`);
    return this.aiModelService.prompt(systemMessage, userPrompt, { parsedError, scenario });
  }

  private async callAiToGenerateCodeFix(
    specification: Specification,
    scenario: TestScenario,
    parsedError: ParsedErrorDetails, 
    analysis: string, 
  ): Promise<string> {
    const systemMessage = "You are an expert TypeScript software development assistant. Based on the test failure diagnosis and the specification, generate the minimal TypeScript code change (ideally as a diff in unified format, or the modified function/code block) required to make the test pass. The change will be applied to the original project files. Only output the code change or diff as a JSON object { \"filePathToModify\": string, \"codeOrDiffContent\": string, \"type\": \"full_content\" | \"diff\" }.";
    let originalFilePathForFix = specification.affectedFiles[0]; 
    if (parsedError.filePath) {
        const erroredFileName = path.basename(parsedError.filePath);
        // Ensure affectedFiles is an array before calling find
        const affectedFiles = Array.isArray(specification.affectedFiles) ? specification.affectedFiles : [specification.affectedFiles];
        const foundPath = affectedFiles.find(f => path.basename(f) === erroredFileName);
        if (foundPath) originalFilePathForFix = foundPath;
    }

    let fileContentForPrompt = "[]"; // Default if file can't be read or path is unknown
    if (originalFilePathForFix && originalFilePathForFix !== 'unknown') {
      try {
        console.log(`Reading content of ${originalFilePathForFix} to include in prompt for AI code fix.`);
        fileContentForPrompt = await this.fileSystemService.readFile(originalFilePathForFix);
      } catch (e: any) {
        console.warn(`AgenticTddService: Could not read file ${originalFilePathForFix} to provide context for AI code fix. Error: ${e.message}`);
        fileContentForPrompt = `[Could not read file content: ${e.message}]`;
      }
    }

    const userPrompt = `Generate a code fix for the following:
Test Failure Diagnosis: ${analysis}
Test Name: ${parsedError.testName}
Error Message: ${parsedError.errorMessage}
Relevant Test Scenario: ${scenario.description}
Focus Area: ${scenario.focusArea}
Specification Context: ${specification.featureDescription}
Original file path to modify: ${originalFilePathForFix || 'unknown'}
Code to Modify (if available):
\`\`\`typescript
${fileContentForPrompt}
\`\`\`
Please ensure your output is ONLY the specified JSON object.`;

    console.log(`AI: Generating code fix for scenario: "${scenario.description}"`);
    return this.aiModelService.prompt(systemMessage, userPrompt, { 
      analysis, 
      parsedError, 
      scenario, 
      originalFilePath: originalFilePathForFix,
      originalFileContent: fileContentForPrompt !== "[]" && !fileContentForPrompt.startsWith("[Could not read") ? fileContentForPrompt : undefined 
    });
  }

  private sanitizeForFileName(description: string): string {
    return description.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-._]/g, ''); // Added ._ to allow them in filenames
  }
  
  private async applyAiFix(aiFix: AiFixResponse): Promise<void> {
    console.log(`Applying AI fix to: ${aiFix.filePathToModify} (Type: ${aiFix.type})`);
    await this.fileSystemService.ensureDirectoryExists(path.dirname(aiFix.filePathToModify)); 

    if (aiFix.type === 'diff') {
      await this.fileSystemService.applyDiff(aiFix.filePathToModify, aiFix.codeOrDiffContent);
    } else {
      await this.fileSystemService.writeFile(aiFix.filePathToModify, aiFix.codeOrDiffContent);
    }
    console.log(`Successfully applied fix to ${aiFix.filePathToModify}`);
  }
  
  private async callAiToGenerateHolisticFix(
    specification: Specification,
    allAffectedFileContents: {filePath: string, content: string}[],
    failedTestDetails: ParsedErrorDetails[]
  ): Promise<string> {
    const systemMessage = `You are an expert TypeScript software development assistant. Multiple tests from the specification are failing.
Analyze the provided code for ALL affected files, the overall feature description, and details of ALL currently failing test scenarios.
Generate a comprehensive set of changes (ideally as a single JSON object { "filePathToModify": string, "codeOrDiffContent": string, "type": "full_content" | "diff" }, or an array of such objects if multiple files need changes)
to address all reported failures and ensure the feature is implemented correctly according to the specification.
The changes will be applied to the original project files.
Output ONLY the JSON for the code change(s).`;

    const userPrompt = `Holistic Code Fix Request:
Feature Description: ${specification.featureDescription}

Affected Files Content:
${allAffectedFileContents.map(f => `// File: ${f.filePath}\n${f.content}`).join('\n\n---\n\n')}

Currently Failing Test Scenarios:
${failedTestDetails.map(err => `  Test: ${err.testName || 'Unknown Test'}\n  Error: ${err.errorMessage}\n  File: ${err.filePath || 'N/A'}:${err.lineNumber || 'N/A'}\n  Raw: ${err.rawError?.substring(0, 200) || 'N/A'}`).join('\n\n')}

Generate the necessary code changes to fix all these issues.`;

    console.log(`AI: Generating HOLISTIC code fix for specification: "${specification.featureDescription}"`);
    return this.aiModelService.prompt(systemMessage, userPrompt, { specification, allAffectedFileContents, failedTestDetails });
  }

  private async runAllSpecificationTests(
    specification: Specification,
    generatedTestCodeMap: Map<string, { testCode: string, testFileName: string, tempDirNamePrefix: string }>,
    sourceFilesToCopy: SourceFileToCopy[]
  ): Promise<{ allPassed: boolean; failedTestDetails: ParsedErrorDetails[] }> {
    console.log("\n--- Running ALL tests for the current specification ---");
    const allFailedDetails: ParsedErrorDetails[] = [];
    let allTestsInSpecPassed = true;

    for (const scenario of specification.testScenarios) {
      const testInfo = generatedTestCodeMap.get(scenario.description);
      if (!testInfo) {
        console.error(`ERROR: No generated test code found for scenario: "${scenario.description}" during all spec tests run.`);
        allFailedDetails.push({
            testName: scenario.description,
            errorMessage: "Test code not found for this scenario.",
            rawError: "Test code not found for this scenario."
        });
        allTestsInSpecPassed = false;
        continue;
      }

      console.log(`Running test for (spec scenario): "${scenario.description}" (File: ${testInfo.testFileName})`);
      const testResult: TestResult = await this.testRunnerService.runTest(
        testInfo.testCode,
        testInfo.testFileName,
        testInfo.tempDirNamePrefix,
        sourceFilesToCopy,
        scenario.description
      );

      if (!testResult.success) {
        allTestsInSpecPassed = false;
        const errors = this.outputParser.parse(testResult.message || '', testResult.error || '');
        if (errors.length > 0) {
          allFailedDetails.push(...errors);
        } else {
          allFailedDetails.push({
            testName: scenario.description,
            errorMessage: testResult.error || "Test failed without specific parsed error.",
            rawError: testResult.message || testResult.error || "No raw error output.",
          });
        }
        console.log(`Test FAILED (spec scenario): "${scenario.description}"`);
      } else {
        console.log(`Test PASSED (spec scenario): "${scenario.description}"`);
      }
    }
    console.log("--- Finished running ALL tests for the current specification ---");
    return { allPassed: allTestsInSpecPassed, failedTestDetails: allFailedDetails };
  }

  private async processSingleScenario(
    specification: Specification,
    scenario: TestScenario,
    generatedTestCode: string,
    testFileName: string,
    tempDirNamePrefix: string,
    sourceFilesToCopy: SourceFileToCopy[],
    generatedTestCodeMap: Map<string, { testCode: string, testFileName: string, tempDirNamePrefix: string }> 
  ): Promise<boolean> {
    // Logging the content of the generated test file before running it
    console.log(`--- Content of generated test file ${testFileName} (to be written by TestRunnerService): ---`);
    console.log(generatedTestCode);
    console.log(`----------------------------------------`);
    // The above block is added as per the subtask. Note that AgenticTddService
    // does not write this file itself; it passes the content to TestRunnerService.
    // The actual file path (testFilePath in the prompt) is determined within TestRunnerService.

    console.log(`Running initial test for "${scenario.description}" (expecting failure): ${testFileName}`);
    let testResult: TestResult = await this.testRunnerService.runTest(
      generatedTestCode, testFileName, tempDirNamePrefix, sourceFilesToCopy, scenario.description
    );
    console.log('Initial test run result:', { success: testResult.success, message: testResult.message?.substring(0, 100), error: testResult.error?.substring(0, 100) });

    if (testResult.success) {
      console.warn(`WARNING: Test for "${scenario.description}" passed unexpectedly on the first run. Skipping development cycle for this scenario.`);
      return true; 
    }

    const MAX_HOLISTIC_ITERATIONS = 3;
    for (let i = 0; i < MAX_HOLISTIC_ITERATIONS; i++) {
      console.log(`Holistic Remediation Attempt ${i + 1}/${MAX_HOLISTIC_ITERATIONS} for scenario: "${scenario.description}"`);

      const parsedErrorsArray = this.outputParser.parse(testResult.message || '', testResult.error || '');
      const primaryError = parsedErrorsArray[0] || {
        testName: scenario.description,
        errorMessage: testResult.error || "No specific error message parsed from TestRunner.",
        rawError: testResult.error || testResult.message || "No raw error.",
      };
      
      const analysis = await this.callAiToAnalyzeFailure(specification, scenario, primaryError);
      console.log(`AI Analysis (Attempt ${i+1}): ${analysis}`);

      const aiFixResponseString = await this.callAiToGenerateCodeFix(specification, scenario, primaryError, analysis);
      console.log(`AI Generated Fix (Attempt ${i+1}, raw JSON string):\n${aiFixResponseString}`);
      
      try {
        const aiFix = JSON.parse(String(aiFixResponseString)) as AiFixResponse; // Ensured String() from subtask 3
        await this.applyAiFix(aiFix);
      } catch (e: any) {
        console.error(`Failed to parse or apply AI fix JSON (Attempt ${i+1}):`, e);
        if (i === MAX_HOLISTIC_ITERATIONS - 1) {
          console.error(`Scenario "${scenario.description}" failed: Max iterations reached and initial fix failed to parse/apply.`);
          return false; 
        }
        continue; // Try next iteration, hoping for a better AI response.
      }

      const holisticTestRunResult = await this.runAllSpecificationTests(specification, generatedTestCodeMap, sourceFilesToCopy);

      if (holisticTestRunResult.allPassed) {
        console.log(`SUCCESS: All specification tests passed after fix in iteration ${i + 1} for scenario "${scenario.description}".`);
        return true; 
      } else {
        console.log(`Holistic Remediation: Failures detected after applying fix. ${holisticTestRunResult.failedTestDetails.length} tests failing.`);
        holisticTestRunResult.failedTestDetails.forEach(detail => console.log(`  - ${detail.testName}: ${detail.errorMessage}`));
        
        if (i === MAX_HOLISTIC_ITERATIONS - 1) {
          console.error(`ERROR: Scenario "${scenario.description}" failed after max holistic remediation attempts.`);
          return false; 
        }

        const allAffectedFileContents = [];
        // Ensure affectedFiles is an array before iterating
        const affectedFiles = Array.isArray(specification.affectedFiles) ? specification.affectedFiles : [specification.affectedFiles];
        for (const filePath of affectedFiles) {
            try {
                const content = await this.fileSystemService.readFile(filePath);
                allAffectedFileContents.push({filePath, content});
            } catch (e:any) {
                console.warn(`Could not read file ${filePath} for holistic fix: ${e.message}`);
                allAffectedFileContents.push({filePath, content: "// File not found or could not be read"});
            }
        }
        
        const holisticFixResponseString = await this.callAiToGenerateHolisticFix(specification, allAffectedFileContents, holisticTestRunResult.failedTestDetails);
        console.log(`AI Generated HOLISTIC Fix (Attempt ${i+1}, raw JSON string):\n${holisticFixResponseString}`);
        try {
          const parsedHolisticFix = JSON.parse(String(holisticFixResponseString)); // Ensured String()
          const fixesToApply: AiFixResponse[] = Array.isArray(parsedHolisticFix) ? parsedHolisticFix : [parsedHolisticFix];
          
          for (const fix of fixesToApply) {
             await this.applyAiFix(fix);
          }
        } catch (e: any) {
          console.error(`Failed to parse or apply AI HOLISTIC fix JSON (Attempt ${i+1}):`, e);
          // If holistic fix fails to parse/apply, loop continues, next iteration will try again.
        }
      }
    }
    console.error(`ERROR: Scenario "${scenario.description}" failed after all holistic remediation attempts.`);
    return false; 
  }

  public async processSpecification(specification: Specification): Promise<boolean> {
    let allScenariosInSpecPassed = true;

    // Ensure affectedFiles is an array before mapping
    const affectedFiles = Array.isArray(specification.affectedFiles) ? specification.affectedFiles : [specification.affectedFiles];
    const sourceFilesToCopy: SourceFileToCopy[] = affectedFiles.map(filePath => ({
      originalPath: filePath,
      targetNameInTemp: path.basename(filePath)
    }));
    const copiedFileTargetNames = sourceFilesToCopy.map(f => f.targetNameInTemp);

    const generatedTestCodeMap = new Map<string, { testCode: string, testFileName: string, tempDirNamePrefix: string }>();
    console.log("\n--- Pre-generating all test files for the specification ---");
    for (const scenario of specification.testScenarios) {
      const safeScenarioDesc = this.sanitizeForFileName(scenario.description);
      const testFileName = `test-${safeScenarioDesc}.test.ts`;
      const tempDirNamePrefix = `agentic-tdd-${safeScenarioDesc}`;
      try {
        const testCode = await this.callAiToGenerateTestCode(specification, scenario, copiedFileTargetNames);
        generatedTestCodeMap.set(scenario.description, { testCode, testFileName, tempDirNamePrefix });
        console.log(`Generated test code for scenario: "${scenario.description}" -> ${testFileName}`);
      } catch (e: any) {
        console.error(`FATAL: Failed to generate test code for scenario "${scenario.description}": ${e.message}`);
        allScenariosInSpecPassed = false; 
        return false; 
      }
    }
    if (!allScenariosInSpecPassed) { 
        console.error("Halting specification processing due to test generation errors.");
        return false;
    }
    console.log("--- Finished pre-generating all test files ---\n");

    try {
      for (const scenario of specification.testScenarios) {
        console.log(`\n--- Processing Test Scenario: "${scenario.description}" ---`);
        const testInfo = generatedTestCodeMap.get(scenario.description);
        if (!testInfo) { 
            console.error(`CRITICAL ERROR: Missing pre-generated test code for scenario "${scenario.description}" during processing.`);
            allScenariosInSpecPassed = false;
            continue; 
        }

        const scenarioPassed = await this.processSingleScenario(
          specification,
          scenario,
          testInfo.testCode,
          testInfo.testFileName,
          testInfo.tempDirNamePrefix,
          sourceFilesToCopy,
          generatedTestCodeMap
        );
        
        if (!scenarioPassed) {
            allScenariosInSpecPassed = false;
            console.error(`Scenario "${scenario.description}" ultimately failed.`);
        }
        console.log(`--- Finished processing Test Scenario: "${scenario.description}" (Passed: ${scenarioPassed}) ---`);
      }
    } catch (e: any) { 
        console.error(`FATAL ERROR during specification processing loop: ${e.message}`, e.stack);
        allScenariosInSpecPassed = false;
    } 

    if (allScenariosInSpecPassed) {
        console.log(`\nSUCCESS: All test scenarios in specification "${specification.featureDescription}" passed.`);
        console.log("// TODO: Implement full project test suite run here. For now, simulating success.");
    } else {
        console.error(`\nFAILURE: One or more scenarios in specification "${specification.featureDescription}" failed.`);
    }

    console.log(`\nProcessing Complete for specification "${specification.featureDescription}". Overall success: ${allScenariosInSpecPassed}`);
    return allScenariosInSpecPassed;
  }
}
