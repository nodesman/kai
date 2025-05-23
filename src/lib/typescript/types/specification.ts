export interface TestScenario {
  description: string;
  type: 'unit' | 'integration' | 'e2e';
  focusArea: string;
  expectedOutcome?: string;
}

export interface Specification {
  featureDescription: string;
  affectedFiles: string[];
  changes: Array<{
    filePath: string;
    description: string;
    type: 'modification' | 'creation' | 'deletion';
    targetElement?: string;
  }>;
  dataModels?: Array<object | string>;
  nonFunctionalRequirements?: string[];
  testScenarios: TestScenario[];
}
