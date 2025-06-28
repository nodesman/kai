jest.mock('chalk');
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));
import * as fsSync from 'fs';
import yaml from 'js-yaml';
import { Config } from '../Config';

describe('Config', () => {

  it('uses default values when config.yaml is missing', () => {
    process.env.GEMINI_API_KEY = 'testkey';
    (fsSync.existsSync as jest.Mock).mockReturnValue(false);
    const cfg = new Config();
    expect(cfg.gemini.api_key).toBe('testkey');
    expect(cfg.gemini.model_name).toBe('gemini-2.5-flash');
    expect(cfg.project.root_dir).toBe('generated_project');
    expect(cfg.analysis.cache_file_path).toBe('.kai/project_analysis.json');
    expect(cfg.context.mode).toBeUndefined();
  });

  it('loads values from config.yaml when present', () => {
    process.env.GEMINI_API_KEY = 'okey';
    (fsSync.existsSync as jest.Mock).mockReturnValue(true);
    (fsSync.readFileSync as jest.Mock).mockReturnValue(
      `gemini:\n  model_name: custom-model\nproject:\n  root_dir: foo\nanalysis:\n  cache_file_path: bar\ncontext:\n  mode: dynamic\n`
    );
    const cfg = new Config();
    expect(cfg.gemini.model_name).toBe('custom-model');
    expect(cfg.project.root_dir).toBe('foo');
    expect(cfg.analysis.cache_file_path).toBe('bar');
    expect(cfg.context.mode).toBe('dynamic');
  });
});