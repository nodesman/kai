export interface ParsedErrorDetails {
  testName: string;
  errorMessage: string;
  filePath?: string;
  lineNumber?: number;
  rawError: string;
}

export interface ITestOutputParser {
  parse(rawStdout: string, rawStderr: string): ParsedErrorDetails[];
}

export class JestOutputParser implements ITestOutputParser {
  // Regex to identify the start of a Jest test failure block (e.g., "● Test suite > Test name")
  // It captures the full test name.
  private readonly testFailureHeaderRegex = /●\s(.+)/;

  // Regex to capture the error message, typically starts after the test name,
  // and can span multiple lines. We'll look for indentation.
  private readonly errorMessageRegex = /^\s{2,}([\s\S]*?)(?=\s{2}at\s|\s{2}Expected| FAIL | ✓| ●|$)/m;

  // Regex to find file paths and line numbers (e.g., "at /path/to/file.ts:12:34" or "(/path/to/file.ts:12:34)")
  // This will capture the filePath and lineNumber.
  private readonly filePathRegex = /(?:at\s.*?\(?|^\s{4})(.*?):(\d+):\d+\)?$/m;


  public parse(rawStdout: string, rawStderr: string): ParsedErrorDetails[] {
    const errors: ParsedErrorDetails[] = [];
    // Combine stdout and stderr as Jest often prints failure details to stdout
    const output = rawStdout + "\n" + rawStderr;
    const lines = output.split('\n');

    // Split the output into blocks for each potential failure.
    // Jest failure reports often start with " FAIL " or contain "● ".
    const failureBlocks = output.split(/ FAIL /).slice(1); // Remove anything before the first " FAIL "

    if (failureBlocks.length === 0 && !output.includes("●")) {
        // If no " FAIL " and no "●", check the whole output for individual test markers
        // This is a fallback for when split by " FAIL " doesn't yield blocks but there are errors
        if (output.includes("●")) {
            failureBlocks.push(output);
        } else {
            return []; // No clear failure indicators
        }
    }


    for (const block of failureBlocks) {
      const testNameMatch = block.match(this.testFailureHeaderRegex);
      if (!testNameMatch) continue;

      const fullTestName = testNameMatch[1].trim();
      
      // The raw error for this block starts from the test name line
      let rawErrorSnippet = `● ${fullTestName}\n`;
      const linesInBlock = block.split('\n');
      let errorMessage = "Error message not found.";
      let filePath: string | undefined;
      let lineNumber: number | undefined;

      // Search for the detailed error message, which usually follows the header
      // and is indented.
      let errorMessageContent = "";
      let capturingErrorMessage = false;
      for(let i = 0; i < linesInBlock.length; i++) {
          const line = linesInBlock[i];
          if (line.trim().startsWith('●') && i > 0) break; // Start of next test result in same block

          if (line.match(/^\s{2,}\S+/) && !line.match(/^\s{2,}at\s/)) { // Indented line, not a stack trace line
              capturingErrorMessage = true;
              errorMessageContent += line.trimLeft() + "\n";
          } else if (capturingErrorMessage && (line.match(/^\s{2,}at\s/) || line.trim() === '' || line.match(/●/))) {
              // Stop if we hit a stack trace, an empty line after message, or another test header
              break;
          }
          rawErrorSnippet += line + "\n"; // Add to raw error snippet
      }
      if(errorMessageContent.trim()) {
        errorMessage = errorMessageContent.trim();
      }


      // Try to find file path and line number within the block
      // Jest stack traces often point to the test file itself or the source of an error
      const filePathMatch = block.match(this.filePathRegex);
      if (filePathMatch) {
        filePath = filePathMatch[1];
        lineNumber = parseInt(filePathMatch[2], 10);
      }
      
      // Fallback for error message if specific indented block not found, grab next few lines
      if (errorMessage === "Error message not found.") {
          const headerIndex = block.indexOf(fullTestName);
          if (headerIndex !== -1) {
              const potentialError = block.substring(headerIndex + fullTestName.length).split('\n').slice(1, 4).join('\n').trim();
              if (potentialError && !potentialError.startsWith("at ")) {
                  errorMessage = potentialError;
              }
          }
      }


      errors.push({
        testName: fullTestName,
        errorMessage: errorMessage,
        filePath: filePath,
        lineNumber: lineNumber,
        rawError: block.trim(), // Use the processed block as the raw error
      });
    }
    return errors;
  }
}
