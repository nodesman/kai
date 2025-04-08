// src/lib/ShellExecutor.ts
import { exec as execCb, spawn, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

const exec = promisify(execCb);

interface ShellExecuteResult {
    stdout: string;
    stderr: string;
}

export class ShellExecutor {

    /**
     * Executes a shell command and returns its stdout and stderr.
     * Best for commands that terminate quickly and return output.
     * @param command The command to execute (e.g., "git status --porcelain").
     * @param options Options, including 'cwd' for working directory.
     * @returns Promise resolving to { stdout, stderr }.
     * @throws Error if the command fails (non-zero exit code).
     */
    async execute(command: string, options: { cwd?: string } = {}): Promise<ShellExecuteResult> {
        try {
            console.log(chalk.dim(`Executing shell command: ${command}${options.cwd ? ` in ${options.cwd}` : ''}`));
            const { stdout, stderr } = await exec(command, { cwd: options.cwd });
            return { stdout: stdout.trim(), stderr: stderr.trim() };
        } catch (error: any) {
            console.error(chalk.red(`Error executing command "${command}":`), error.stderr || error.stdout || error.message);
            // Re-throw a more informative error
            const executionError = new Error(`Command failed: "${command}". Exit Code: ${error.code}. Stderr: ${error.stderr?.trim() || 'N/A'}. Stdout: ${error.stdout?.trim() || 'N/A'}`) as any;
            executionError.stdout = error.stdout;
            executionError.stderr = error.stderr;
            executionError.code = error.code;
            throw executionError;
        }
    }

    /**
     * Spawns a command, waits for it to exit, and optionally inherits stdio.
     * Best for interactive processes or commands requiring specific spawn options (like 'subl -w').
     * @param command The base command (e.g., "subl").
     * @param args Array of arguments (e.g., ["-w", "file.txt"]).
     * @param options Spawn options (e.g., { stdio: 'inherit', cwd: '/path' }).
     * @returns Promise resolving to the exit code, or rejecting on spawn error.
     */
    async spawnAndWait(command: string, args: string[], options: SpawnOptions): Promise<number | null> {
        return new Promise((resolve, reject) => {
            console.log(chalk.dim(`Spawning command: ${command} ${args.join(' ')}${options.cwd ? ` in ${options.cwd}` : ''}`));
            const process = spawn(command, args, options);

            process.on('close', (code) => {
                console.log(chalk.dim(`Command "${command}" closed with code: ${code}`));
                resolve(code);
            });

            process.on('error', (error) => {
                console.error(chalk.red(`Error spawning command "${command}":`), error);
                 if ((error as any).code === 'ENOENT') {
                    reject(new Error(`Command not found: '${command}'. Make sure it's installed and in your PATH.`));
                 } else {
                    reject(error); // Reject with the original error
                 }
            });
        });
    }
}