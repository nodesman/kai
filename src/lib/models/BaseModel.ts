// lib/models/BaseModel.js
class BaseModel {
    constructor(config) {
        this.config = config;
    }

    async getResponseFromAI(conversation) {
        throw new Error("getResponseFromAI must be implemented in derived classes");
    }

    flattenMessages(messages) {
        if (!Array.isArray(messages)) {
            console.error("flattenMessages expects an array of messages.");
            return []; // Or throw an error
        }
        return messages.filter(msg => msg.role && msg.parts && msg.parts[0] && typeof msg.parts[0].text === 'string');
    }
}
export default BaseModel;