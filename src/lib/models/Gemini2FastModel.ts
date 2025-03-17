import BaseModel from "./BaseModel.ts";
class Gemini2FastModel extends BaseModel {
    constructor(config) {
        super(config);
        this.genAI = new GoogleGenerativeAI(this.config.get('geminiPro').api_key);  // Specific config section
        // ... other Gemini Pro setup
    }

    async getResponseFromAI(prompt) {
        // Gemini Pro specific API call logic
    }
}

export default Gemini2FastModel;
