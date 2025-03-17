// lib/models/BaseModel.js
class BaseModel {
    config: any; // Add type annotation.  'any' is the simplest fix, but consider a more specific type later.

    constructor(config: any) { // Add type annotation: any
        this.config = config;
    }

    async getResponseFromAI(conversation: any): Promise<string> { // Add type annotations, and return type
        throw new Error("getResponseFromAI must be implemented in derived classes");
    }

    flattenMessages(messages: any[]): any[] { // Type as array of any
        if (!Array.isArray(messages)) {
            console.error("flattenMessages expects an array of messages.");
            return []; // Or throw an error
        }
        return messages.filter(msg => msg.role && msg.parts && msg.parts[0] && typeof msg.parts[0].text === 'string');
    }
}
export default BaseModel;