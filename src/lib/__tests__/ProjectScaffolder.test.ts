import path from 'path';
import { ProjectScaffolder, ScaffoldOptions } from '../ProjectScaffolder';

describe('ProjectScaffolder.scaffoldProject', () => {
  const fsMock = {
    ensureDirExists: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined)
  } as any;
  const gitMock = {
    initializeRepository: jest.fn().mockResolvedValue(undefined),
    ensureGitignoreRules: jest.fn().mockResolvedValue(undefined)
  } as any;
  let scaffolder: ProjectScaffolder;

  beforeEach(() => {
    jest.clearAllMocks();
    scaffolder = new ProjectScaffolder(fsMock, gitMock);
  });

  it('creates full Node/TypeScript project structure', async () => {
    const opts: ScaffoldOptions = {
      language: 'TypeScript',
      framework: 'Node',
      directoryName: 'proj'
    };
    const cwd = process.cwd();
    const expectedPath = path.resolve(cwd, 'proj');

    const result = await scaffolder.scaffoldProject(opts);

    expect(result).toBe(expectedPath);
    expect(fsMock.ensureDirExists).toHaveBeenCalledWith(expectedPath);
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'README.md'),
      expect.stringContaining('# proj')
    );
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'package.json'),
      expect.stringContaining('"name": "proj"')
    );
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'tsconfig.json'),
      expect.any(String)
    );
    expect(fsMock.ensureDirExists).toHaveBeenCalledWith(path.join(expectedPath, 'src'));
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'src/index.ts'),
      expect.stringContaining('Hello from Kai')
    );
    expect(gitMock.initializeRepository).toHaveBeenCalledWith(expectedPath);
    expect(gitMock.ensureGitignoreRules).toHaveBeenCalledWith(expectedPath);
  });

  it('skips Node extras for other languages', async () => {
    const opts: ScaffoldOptions = {
      language: 'Python',
      framework: 'Flask',
      directoryName: 'pyproj'
    };
    const expectedPath = path.resolve(process.cwd(), 'pyproj');
    await scaffolder.scaffoldProject(opts);

    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join(expectedPath, 'README.md'),
      expect.any(String)
    );
    // package.json should not be created
    expect(fsMock.writeFile).not.toHaveBeenCalledWith(
      path.join(expectedPath, 'package.json'),
      expect.any(String)
    );
  });
});
