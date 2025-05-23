import * as fs from 'fs/promises'; // This import seems unused here, consider removing if AgenticTddService doesn't directly use fs.
import * as path from 'path';
import * as os from 'os'; // This import seems unused here, consider removing if AgenticTddService doesn't directly use os.

import { Specification, TestScenario } from '../../types/specification';
import { ITestRunnerService, SourceFileToCopy } from '../test-runner/ITestRunnerService'; 
import { ITestOutputParser, ParsedErrorDetails } from '../test-parser/JestOutputParser';
import { IAiModelService } from '../ai-model/IAiModelService';
import { IFileSystemService } from '../file-system/IFileSystemService'; 

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

  // **`generate_test_code` Prompt Strategy:**
  //   - **System Message:** "You are an expert TypeScript and Jest test generation assistant. Generate a complete Jest test script based on the provided scenario. Ensure the test initially fails if the described functionality is not present. The test will be run in a temporary directory where specified source files (like those listed) are copied. Therefore, use relative imports for these source files (e.g., `import { MyClass } from './myClassFileName.ts';` if 'myClassFileName.ts' is the target name of a copied source file). Output only the TypeScript code for the test."
  //   - **User Prompt:** "Generate a Jest test for the following scenario:
  //       Scenario Description: ${scenario.description}
  //       Focus Area: ${scenario.focusArea}
  //       Specification Context: ${specification.featureDescription}
  //       Target names of source files that will be copied to the test directory (use relative imports for these): ${copiedFileTargetNames.join(', ')}"
  //   - **Context:** The `TestScenario` object, parts of the `Specification`, target names of source files being copied.
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

  // **`diagnose_test_failure` Prompt Strategy:**
  //   - **System Message:** "You are an expert software diagnostics assistant. Analyze the following test failure details and provide a concise explanation of the likely cause, referencing the specification and code. Identify the specific function or logic that needs to change."
  //   - **User Prompt:** "Diagnose the following Jest test failure:
  //       Test Name: ${parsedError.testName}
  //       Error Message: ${parsedError.errorMessage}
  //       File Path: ${parsedError.filePath}:${parsedError.lineNumber} // This path will be inside the temp dir
  //       Raw Error Output: ${parsedError.rawError}
  //       Relevant Test Scenario: ${scenario.description}
  //       Focus Area: ${scenario.focusArea}
  //       Specification Context: ${specification.featureDescription}
  //       Content of copied source files (if relevant and small enough): [content of source files]"
  //   - **Context:** `ParsedErrorDetails`, `TestScenario`, `Specification`, content of copied source files.
  private async callAiToAnalyzeFailure(
    specification: Specification,
    scenario: TestScenario,
    parsedError: ParsedErrorDetails,
    // TODO: Consider passing content of copied source files if small and relevant for AI analysis
  ): Promise<string> {
    const systemMessage = "You are an expert software diagnostics assistant. Analyze the following test failure details and provide a concise explanation of the likely cause, referencing the specification and code. Identify the specific function or logic that needs to change.";
    const userPrompt = `Diagnose the following Jest test failure:
Test Name: ${parsedError.testName}
Error Message: ${parsedError.errorMessage}
File Path: ${parsedError.filePath || 'N/A'}:${parsedError.lineNumber || 'N/A'}
Raw Error Output: ${parsedError.rawError}
Relevant Test Scenario: ${scenario.description}
Focus Area: ${scenario.focusArea}
Specification Context: ${specification.featureDescription}
Relevant Code Snippets (if available): []`; // Placeholder for source file content

    console.log(`AI: Analyzing test failure for "${scenario.description}"`);
    return this.aiModelService.prompt(systemMessage, userPrompt, { parsedError, scenario });
  }

  // **`generate_code_fix_or_impl` Prompt Strategy:**
  //   - **System Message:** "You are an expert TypeScript software development assistant. Based on the test failure diagnosis and the specification, generate the minimal TypeScript code change (ideally as a diff in unified format, or the modified function/code block) required to make the test pass. The change will be applied to the original project files. Only output the code change or diff."
  //   - **User Prompt:** "Generate a code fix for the following:
  //       Test Failure Diagnosis: [output from diagnose_test_failure]
  //       Test Name: ${parsedError.testName}
  //       Error Message: ${parsedError.errorMessage}
  //       Relevant Test Scenario: ${scenario.description}
  //       Focus Area: ${scenario.focusArea}
  //       Specification Context: ${specification.featureDescription}
  //       Original Code to Modify (from project source file, not the temp copy): [code]"
  //   - **Context:** Diagnosis string, `ParsedErrorDetails`, `TestScenario`, `Specification`, original code to modify.
  private async callAiToGenerateCodeFix(
    specification: Specification,
    scenario: TestScenario,
    parsedError: ParsedErrorDetails, 
    analysis: string, 
  ): Promise<string> {
    const systemMessage = "You are an expert TypeScript software development assistant. Based on the test failure diagnosis and the specification, generate the minimal TypeScript code change (ideally as a diff in unified format, or the modified function/code block) required to make the test pass. The change will be applied to the original project files. Only output the code change or diff.";
    // TODO: In a real system, fetch the content of the *original* source file to provide to the AI.
    // For now, the AI (SimpleAiModelService) is scripted and doesn't use this code.
    // Attempt to find the original file path from specification.affectedFiles based on the filename from parsedError.filePath
    let originalFilePathForFix = specification.affectedFiles[0]; // Default
    if (parsedError.filePath) {
        const erroredFileName = path.basename(parsedError.filePath);
        const foundPath = specification.affectedFiles.find(f => path.basename(f) === erroredFileName);
        if (foundPath) originalFilePathForFix = foundPath;
    }

    const userPrompt = `Generate a code fix for the following:
Test Failure Diagnosis: ${analysis}
Test Name: ${parsedError.testName}
Error Message: ${parsedError.errorMessage}
Relevant Test Scenario: ${scenario.description}
Focus Area: ${scenario.focusArea}
Specification Context: ${specification.featureDescription}
Original file path to modify: ${originalFilePathForFix || 'unknown'} 
Code to Modify (if available): []`; // Placeholder for original file content

    console.log(`AI: Generating code fix for scenario: "${scenario.description}"`);
    return this.aiModelService.prompt(systemMessage, userPrompt, { analysis, parsedError, scenario, originalFilePath: originalFilePathForFix });
  }

  public async processSpecification(specification: Specification): Promise<boolean> {
    let allScenariosPassed = true;

    try {
      for (const scenario of specification.testScenarios) {
        console.log(`\n--- Processing Test Scenario: "${scenario.description}" ---`);
        let scenarioPassed = false;
        // Sanitize file and directory names
        const safeScenarioDesc = scenario.description.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
        const testFileName = `test-${safeScenarioDesc}.test.ts`;
        const tempDirNamePrefix = `agentic-tdd-${safeScenarioDesc}`;

        // Prepare source files to copy
        const sourceFilesToCopy: SourceFileToCopy[] = specification.affectedFiles.map(filePath => ({
          originalPath: filePath,
          targetNameInTemp: path.basename(filePath) 
        }));
        const copiedFileTargetNames = sourceFilesToCopy.map(f => f.targetNameInTemp);

        try {
          // 1. AI: Generate Test Code
          const generatedTestCode = await this.callAiToGenerateTestCode(specification, scenario, copiedFileTargetNames);
          
          // 2. Run Test (Initial Run - Expect Fail)
          console.log(`Running generated test (expecting failure): ${testFileName}`);
          let testResult = await this.testRunnerService.runTest(
            generatedTestCode,
            testFileName,
            tempDirNamePrefix,
            sourceFilesToCopy,
            scenario.description 
          );
          console.log('Initial test run result:', { success: testResult.success, message: testResult.message?.substring(0,100), error: testResult.error?.substring(0,100) });

          if (testResult.success) {
            console.warn(`WARNING: Test for "${scenario.description}" passed unexpectedly on the first run. Skipping development cycle for this scenario.`);
            scenarioPassed = true;
          } else {
            // 3. AI: Analyze Failure
            const parsedErrorsArray = this.outputParser.parse(testResult.message || '', testResult.error || '');
            const primaryError = parsedErrorsArray[0] || { 
                testName: scenario.description, 
                errorMessage: testResult.error || "No specific error message parsed from TestRunner.", 
                rawError: testResult.error || testResult.message || "No raw error.",
            };
            const analysis = await this.callAiToAnalyzeFailure(specification, scenario, primaryError);
            console.log(`AI Analysis: ${analysis}`);

            // 4. AI: Generate Code Fix
            const aiFixResponseString = await this.callAiToGenerateCodeFix(specification, scenario, primaryError, analysis);
            console.log(`AI Generated Fix (raw JSON string from AI):\n${aiFixResponseString}`);

            interface AiFixResponse {
              filePathToModify: string; 
              codeOrDiffContent: string;
              type: 'full_content' | 'diff';
            }

            let aiFix: AiFixResponse;
            try {
              aiFix = JSON.parse(aiFixResponseString);
            } catch (e: any) { // Added type annotation for 'e'
              console.error("Failed to parse AI fix response JSON:", e);
              throw new Error("AI fix response was not valid JSON.");
            }
            
            console.log(`Applying AI fix to: ${aiFix.filePathToModify} (Type: ${aiFix.type})`);
            await this.fileSystemService.ensureDirectoryExists(aiFix.filePathToModify);

            if (aiFix.type === 'diff') {
              await this.fileSystemService.applyDiff(aiFix.filePathToModify, aiFix.codeOrDiffContent);
            } else { 
              await this.fileSystemService.writeFile(aiFix.filePathToModify, aiFix.codeOrDiffContent);
            }
            console.log(`Successfully applied fix to ${aiFix.filePathToModify}`);

            // 5. Re-run Test (After Fix - Expect Pass)
            console.log(`Re-running test (expecting success): ${testFileName}`);
            testResult = await this.testRunnerService.runTest(
              generatedTestCode,
              testFileName,
              tempDirNamePrefix,
              sourceFilesToCopy, // Re-copy the (now fixed) source files
              scenario.description
            );
            console.log('Second test run result:', { success: testResult.success, message: testResult.message?.substring(0,100), error: testResult.error?.substring(0,100) });

            if (testResult.success) {
              console.log(`SUCCESS: Test scenario "${scenario.description}" passed after fix.`);
              scenarioPassed = true;
            } else {
              console.error(`ERROR: Test scenario "${scenario.description}" failed after applying fix.`);
              allScenariosPassed = false;
            }
          }
        } catch (e: any) { // Added type annotation for 'e'
          console.error(`ERROR processing scenario "${scenario.description}": ${e.message}`, e.stack);
          allScenariosPassed = false;
        } 
        
        if (!scenarioPassed) {
            allScenariosPassed = false;
        }
        console.log(`--- Finished processing Test Scenario: "${scenario.description}" ---`);
      }
    } catch (e: any) { // Added type annotation for 'e'
        console.error(`FATAL ERROR during specification processing: ${e.message}`, e.stack);
        allScenariosPassed = false;
    } 

    console.log(`\nProcessing Complete. Overall success: ${allScenariosPassed}`);
    return allScenariosPassed;
  }
}
