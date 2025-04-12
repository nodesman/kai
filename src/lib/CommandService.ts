// File: src/lib/CommandService.ts
import { exec as execCb, ExecOptions } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';

// Promisify exec for async/await usage
const exec = promisify(execCb);

// Define the result type for successful command execution
export interface CommandResult {
    stdout: string;
    stderr: string;
}

// Define the options we can pass to our run method
export interface CommandOptions extends ExecOptions {
    // We inherit options like 'cwd', 'env', 'timeout', etc. from ExecOptions
    // Add any custom options specific to this service if needed in the future
}

export class CommandService {
    /**
     * Executes a shell command asynchronously.
     * Logs the command being executed and its outcome.
     *
     * @param command The command string to execute.
     * @param options Optional execution options (e.g., cwd).
     * @returns A promise that resolves with stdout and stderr on success (exit code 0).
     * @throws An error object containing stdout, stderr, and code if the command exits with a non-zero code or fails to execute.
     */
    async run(command: string, options?: CommandOptions): Promise<CommandResult> {
        const effectiveOptions = { ...options }; // Clone options
        const logCommand = options?.env?.GEMINI_API_KEY
            ? command.replace(options.env.GEMINI_API_KEY, '***') // Basic redaction if API key is in env
            : command;

        console.log(chalk.dim(`🔩 Executing command: ${logCommand}${effectiveOptions.cwd ? ` in ${effectiveOptions.cwd}` : ''}`));

        try {
            const { stdout, stderr } = await exec(command, effectiveOptions);

            if (stderr) {
                // Log stderr even on success, as some commands use it for warnings/info
                console.warn(chalk.yellow(`🔩 Command stderr:\n${stderr.trim()}`));
            }
             console.log(chalk.dim(`🔩 Command stdout:\n${stdout.trim()}`));
             console.log(chalk.dim(`👍 Command executed successfully: ${logCommand}`));

            return { stdout, stderr };
        } catch (error: any) {
            // 'error' here is typically the object thrown by exec on non-zero exit code
            // It should contain stdout, stderr, and code properties.
            console.error(chalk.red(`🔥 Command failed: ${logCommand}`));
            console.error(chalk.red(`   Exit Code: ${error.code ?? 'N/A'}`));
            if (error.stderr) {
                console.error(chalk.red(`   Stderr:\n${error.stderr.trim()}`));
            }
            if (error.stdout) { // Log stdout even on failure, might contain partial output/info
                 console.error(chalk.yellow(`   Stdout (on failure):\n${error.stdout.trim()}`));
            }
            if (!error.code && error.message) { // Handle errors before exec (e.g., command not found)
                console.error(chalk.red(`   Error Message: ${error.message}`));
            }

            // Re-throw the original error object so callers can inspect stdout/stderr/code
            throw error;
        }
    }
}