jest.mock('chalk');
jest.mock('fs', () => {
  const realFs = jest.requireActual('fs');
  return {
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    promises: realFs.promises,
  };
});
import * as fsSync from 'fs';
import yaml from 'js-yaml';
import { Config } from '../Config';

describe('Config defaults and loading', () => {
  it('uses default values when config.yaml is missing', () => {
    process.env.GEMINI_API_KEY = 'testkey';
    process.env.OPENAI_API_KEY = 'ok';
    (fsSync.existsSync as jest.Mock).mockReturnValue(false);
    const cfg = new Config();
    expect(cfg.gemini.api_key).toBe('testkey');
    expect(cfg.gemini.model_name).toBe('gemini-2.5-flash');
    expect(cfg.project.root_dir).toBe('generated_project');
    expect(cfg.analysis.cache_file_path).toBe('.kai/project_analysis.json');
    expect(cfg.context.mode).toBeUndefined();
    expect(cfg.openai?.api_key).toBe('ok');
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

describe('Config saveConfig and path', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'key';
    (fsSync.existsSync as jest.Mock).mockReturnValue(false);
    (fsSync.readFileSync as jest.Mock).mockReturnValue('');
  });

  it('writes config file successfully', async () => {
    const cfg = new Config();
    jest.spyOn(fsSync.promises, 'mkdir').mockResolvedValue(undefined as any);
    jest.spyOn(fsSync, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(cfg.saveConfig()).resolves.toBeUndefined();
    expect(fsSync.promises.mkdir).toHaveBeenCalled();
    expect(fsSync.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.kai/config.yaml'),
      expect.any(String),
      'utf8'
    );
  });

  it('getConfigFilePath returns correct path', () => {
    const cfg = new Config();
    expect(cfg.getConfigFilePath()).toMatch(/\.kai\/config\.yaml$/);
  });
});