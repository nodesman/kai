export function toSnakeCase(str: string): string {
    return str
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/[^a-zA-Z0-9_]/g, '') // Remove non-alphanumeric characters except underscore
        .toLowerCase(); // Convert to lowercase
}
