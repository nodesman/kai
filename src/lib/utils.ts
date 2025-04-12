import {encode as gpt3Encode} from "gpt-3-encoder";

export function toSnakeCase(str: string): string {
    return str.trim()
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .replace(/[^a-zA-Z0-9_]/g, '') // Remove non-alphanumeric characters except underscore
        .replace(/_+/g, '_') //Replace multiple underscores with single underscore
        .toLowerCase(); // Convert to lowercase
}
export function countTokens(text: string): number {
    return gpt3Encode(text).length;
}