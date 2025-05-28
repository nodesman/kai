export interface IFileSystemService {
  /**
   * Reads the content of a file.
   * @param filePath - The path to the file.
   * @returns A promise that resolves to the file content as a string.
   * @throws Error if the file cannot be read (e.g., not found, permissions).
   */
  readFile(filePath: string): Promise<string>;

  /**
   * Writes content to a file, overwriting it if it already exists.
   * Creates the directory structure if it doesn't exist.
   * @param filePath - The path to the file.
   * @param content - The content to write to the file.
   * @returns A promise that resolves when the file has been written.
   * @throws Error if the file cannot be written.
   */
  writeFile(filePath: string, content: string): Promise<void>;

  /**
   * Applies a diff (patch) to a file.
   * The diffContent should be in a standard format (e.g., unified diff).
   * @param filePath - The path to the file to be patched.
   * @param diffContent - The diff content to apply.
   * @returns A promise that resolves when the diff has been applied.
   * @throws Error if the file cannot be read, the patch cannot be applied, or the file cannot be written.
   */
  applyDiff(filePath: string, diffContent: string): Promise<void>;

  /**
   * Ensures that the directory for the given file path exists.
   * If not, it creates the directory structure.
   * @param filePath - The full path to a file.
   * @returns A promise that resolves when the directory structure is ensured.
   */
  ensureDirectoryExists(filePath: string): Promise<void>;
}
