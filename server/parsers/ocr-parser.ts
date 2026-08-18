import { getGeminiClient } from '../gemini';
import { config } from '../config';

export interface OCRResult {
  text: string;
  description: string;
}

export class OCRParser {
  public static async parseImage(buffer: Buffer, mimeType: string): Promise<OCRResult> {
    const ai = getGeminiClient();
    if (!ai) {
      return {
        text: `[Image / Scanned File: ${mimeType}, ${buffer.length} bytes]`,
        description: 'Uploaded visual asset (Gemini API key required for full visual OCR text extraction).',
      };
    }

    const models = ['gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
    const base64Data = buffer.toString('base64');
    let extractedText = '';

    for (const model of models) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: 'Perform high-precision Optical Character Recognition (OCR) and semantic extraction on this document image. Extract all text, labels, tables, and visible structured data verbatim. Output the full text with appropriate headings.',
                },
                {
                  inlineData: {
                    mimeType,
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        });

        extractedText = response.text?.trim() || '';
        if (extractedText) break;
      } catch (err: any) {
        console.warn(`[OCRParser] Model ${model} OCR failed: ${err.message?.slice(0, 100)}`);
      }
    }

    return {
      text: extractedText || `[Extracted Image Asset: ${mimeType}]`,
      description: 'Multimodal Gemini Vision OCR extraction.',
    };
  }
}
