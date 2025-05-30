// src/lib/typescript/services/ai-model/RealAiModelService.ts
import { IAiModelService } from './IAiModelService';
import { IConfig } from '../../../Config'; // Adjust path as necessary if IConfig is moved or re-exported
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import chalk from 'chalk'; // Added chalk import

export class RealAiModelService implements IAiModelService {
  private config: IConfig;
  private simulationMode: boolean = false;

  constructor(config: IConfig) {
    this.config = config;
    if (!this.config.gemini.api_key) {
      this.simulationMode = true;
      console.warn(chalk.magentaBright("********************************************************************"));
      console.warn(chalk.magentaBright("RealAiModelService: GEMINI_API_KEY is missing or empty."));
      console.warn(chalk.magentaBright("RUNNING IN SIMULATION MODE. NO REAL AI CALLS WILL BE MADE."));
      console.warn(chalk.magentaBright("Mocked structured responses will be provided for known scenarios."));
      console.warn(chalk.magentaBright("********************************************************************"));
    }
    console.log(this.simulationMode ? chalk.yellow("RealAiModelService instantiated in SIMULATION MODE.") : "RealAiModelService instantiated.");
  }

  public async prompt(systemMessage: string, userPrompt: string, context?: any): Promise<string> {
    if (this.simulationMode) {
      console.log(chalk.blue("RealAiModelService (Simulation Mode): Processing prompt."));
      // console.log(chalk.blue("System Message (snippet):", systemMessage.substring(0, 100) + "...")); // Optional: log for debug
      // console.log(chalk.blue("User Prompt (snippet):", userPrompt.substring(0, 200) + "...")); // Optional: log for debug
      // if (context) {
      //   console.log(chalk.blue("Context provided:", Object.keys(context))); 
      // }


      if (userPrompt.includes("Generate a code fix for the following") && context?.scenario?.description === "should correctly subtract two numbers") {
        console.log(chalk.blue("RealAiModelService (Simulation Mode): Providing mocked code fix for 'subtract' scenario."));
        const mockFilePath = 'src/lib/sample-project/calculator.ts'; // Standard path
        const mockCodeContent = `// src/lib/sample-project/calculator.ts
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b; // Mocked subtract method
  }
}`;
        return Promise.resolve(JSON.stringify({
          filePathToModify: mockFilePath,
          codeOrDiffContent: mockCodeContent,
          type: 'full_content'
        }));
      } else if (userPrompt.includes("Generate a Jest test for the following scenario") && userPrompt.includes("Scenario Description: should correctly subtract two numbers")) {
         console.log(chalk.blue("RealAiModelService (Simulation Mode): Providing mocked Jest test for 'subtract' scenario."));
         const mockTestContent = `
import { Calculator } from './calculator'; // Assuming test runs from a temp dir with calculator.ts copied
describe('Calculator.subtract', () => {
  it('should correctly subtract two numbers', () => {
    const calculator = new Calculator();
    expect(calculator.subtract(5, 2)).toBe(3);
    expect(calculator.subtract(0, 0)).toBe(0);
    expect(calculator.subtract(-5, -2)).toBe(-3);
  });
});`;
         return Promise.resolve(mockTestContent);
      } else if (userPrompt.includes("Diagnose the following Jest test failure") && userPrompt.includes("Test Name: should correctly subtract two numbers")) {
        // Note: AgenticTddService sends 'context.testName' for diagnosis, which is part of userPrompt here.
         console.log(chalk.blue("RealAiModelService (Simulation Mode): Providing mocked diagnosis for 'subtract' failure."));
         return Promise.resolve(`SIMULATED AI Diagnosis: The test 'Calculator.subtract > should correctly subtract two numbers' failed.
Likely cause: The 'subtract' method is missing from the Calculator class or not implemented correctly.
File: src/lib/sample-project/calculator.ts.
Focus on implementing the 'subtract' method.`);
      }
      // Fallback for other prompts in simulation mode
      console.log(chalk.yellow("RealAiModelService (Simulation Mode): No specific mock for this prompt. User Prompt (start):"), userPrompt.substring(0, 150) + "...");
      if (context?.scenario) {
        console.log(chalk.yellow("Context scenario description:"), context.scenario.description);
      }
      if (context?.testName) {
        console.log(chalk.yellow("Context testName:"), context.testName);
      }
      if (userPrompt.includes("Holistic Code Fix Request")) {
        console.log(chalk.blue("RealAiModelService (Simulation Mode): Providing generic empty JSON for Holistic fix."));
        return Promise.resolve(JSON.stringify({
          // filePathToModify: null, // Or some other valid JSON structure if AgenticTddService requires specific fields
          // codeOrDiffContent: "// No specific holistic fix from simulation",
          // type: "info_only" 
        })); // Return empty JSON object, or a structured "no_op"
      }
      return Promise.resolve(`// RealAiModelService (Simulation Mode): Generic placeholder response for prompt: ${userPrompt.substring(0, 100)}...`);
    }

    // --- Real AI Call Logic (if not in simulation mode) ---
    console.log("RealAiModelService: Attempting real AI call.");
    // console.log("System Message (snippet):", systemMessage.substring(0, 100) + "..."); // Already logged by caller or earlier in real path
    // console.log("User Prompt (snippet):", userPrompt.substring(0, 200) + "...");
    // if (context) {
    //   console.log("Context provided:", Object.keys(context)); 
    // }

    const modelName = this.config.gemini.model_name;
    console.log(`Using AI model: ${modelName}`);

    try {
      const genAI = new GoogleGenerativeAI(this.config.gemini.api_key);
      const model = genAI.getGenerativeModel({ model: modelName });

      const fullPrompt = `${systemMessage}

---

User Prompt:
${userPrompt}

---
Context (if any):
${context ? JSON.stringify(context, null, 2) : 'No additional context provided.'}`;
      
      // Optional: Log the full combined prompt for debugging during development
      // console.log("Full prompt being sent to AI:\n", fullPrompt);

      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      ];
      
      const generationConfig = {
          maxOutputTokens: this.config.gemini.max_output_tokens || 8192, // Default to 8192 if not set
      };

      console.log(`RealAiModelService: Sending request to Gemini model ${modelName}. Max tokens: ${generationConfig.maxOutputTokens}`);
      const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          safetySettings,
          generationConfig
      });
      
      const aiResponse = result.response;
      const responseText = aiResponse.text();
      
      console.log("RealAiModelService: Received response from AI.");
      // console.log("AI Response (snippet):", responseText.substring(0, 200) + "...");
      return responseText;

    } catch (error) {
      console.error(chalk.red("RealAiModelService: Error during AI API call:"), error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return `// RealAiModelService: Error calling AI - ${errorMessage}`;
    }
  }

  // Potential future helper methods for API interaction could go here
}
