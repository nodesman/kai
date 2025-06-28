jest.mock('chalk', () => ({ __esModule: true, default: new Proxy({}, { get: () => (s: string) => s }) }));
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Config } from './Config';

jest.spyOn(os, 'tmpdir').mockReturnValue(process.cwd());

describe('ConfigLoader (phase 1)', () => {
  const tmpPrefix = path.join(os.tmpdir(), 'kai-config-test-');
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(tmpPrefix);
    process.chdir(tmpDir);
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  test('exits when GEMINI_API_KEY is not set', () => {
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(((code?: number) => { throw new Error(`process.exit:${code}`); }) as any);
    expect(() => new Config()).toThrow(/process.exit:1/);
    exitSpy.mockRestore();
  });

  test('loads defaults when no config.yaml exists', () => {
    process.env.GEMINI_API_KEY = 'dummy-key';
    const config = new Config();
    expect(config.gemini.api_key).toBe('dummy-key');
    expect(config.gemini.model_name).toBe('gemini-2.5-flash');
    expect(config.gemini.subsequent_chat_model_name).toBe('gemini-2.5-pro');
    expect(config.analysis.cache_file_path).toBe('.kai/project_analysis.json');
    expect(config.project.root_dir).toBe('generated_project');
    expect(config.project.chats_dir).toBe('.kai/logs');
    expect(config.chatsDir).toBe(path.resolve(tmpDir, '.kai/logs'));
    expect(config.context.mode).toBeUndefined();
  });

  test('applies overrides from .kai/config.yaml', () => {
    process.env.GEMINI_API_KEY = 'key';
    const kaiDir = path.join(tmpDir, '.kai');
    fs.mkdirSync(kaiDir, { recursive: true });
    const yaml = `
gemini:
  model_name: 'foo-model'
  max_output_tokens: 1234
project:
  root_dir: 'my_root'
  chats_dir: 'my_logs'
analysis:
  cache_file_path: 'my_cache.json'
context:
  mode: 'analysis_cache'
`;
    fs.writeFileSync(path.join(kaiDir, 'config.yaml'), yaml, 'utf8');
    const config = new Config();
    expect(config.gemini.model_name).toBe('foo-model');
    expect(config.gemini.max_output_tokens).toBe(1234);
    expect(config.project.root_dir).toBe('my_root');
    expect(config.project.chats_dir).toBe('my_logs');
    expect(config.analysis.cache_file_path).toBe('my_cache.json');
    expect(config.context.mode).toBe('analysis_cache');
    expect(config.chatsDir).toBe(path.resolve(tmpDir, 'my_logs'));
  });
});