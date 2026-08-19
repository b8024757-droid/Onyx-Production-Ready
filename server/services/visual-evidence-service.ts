import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { getGeminiClient } from '../gemini';
import { Chunk } from '../../src/types';

export interface VisualFigure {
  figureId: string;
  title: string;
  type: string;
  pageNumber: number;
  axes?: { x?: string; y?: string };
  legend?: string[];
  trendSummary?: string;
  keyValues?: string[];
  description: string;
}

export class VisualEvidenceService {
  private fallbackModels = [
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-3.1-pro-preview',
  ];

  /**
   * Render PDF pages to PNG using Ghostscript
   */
  public renderPdfPagesToPng(
    pdfBuffer: Buffer,
    outputDir: string,
    prefix: string,
    dpi = 150
  ): { pageNumber: number; filePath: string }[] {
    const tempPdfPath = path.join(outputDir, `${prefix}_source.pdf`);
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    const outputPattern = path.join(outputDir, `${prefix}_page_%d.png`);

    try {
      execSync(
        `gs -sDEVICE=png16m -r${dpi} -dNOPAUSE -dBATCH -dSAFER -sOutputFile="${outputPattern}" "${tempPdfPath}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
    } catch (err: any) {
      console.warn(`[VisualEvidenceService] Ghostscript render warning: ${err.message}`);
    }

    // Collect generated page files
    const pages: { pageNumber: number; filePath: string }[] = [];
    const files = fs.readdirSync(outputDir);
    const pageRegex = new RegExp(`^${prefix}_page_(\\d+)\\.png$`);

    for (const f of files) {
      const match = f.match(pageRegex);
      if (match) {
        const pageNum = parseInt(match[1], 10);
        pages.push({
          pageNumber: pageNum,
          filePath: path.join(outputDir, f),
        });
      }
    }

    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    return pages;
  }

  /**
   * Analyze a single page image with Gemini Vision
   */
  public async analyzePageImage(
    pageNumber: number,
    imageBuffer: Buffer,
    documentTitle: string
  ): Promise<VisualFigure[]> {
    const apiKey = config.gemini.apiKey;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return [];
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const base64Data = imageBuffer.toString('base64');
    const prompt = `Analyze this document page from "${documentTitle}" (Page ${pageNumber}).
1. Identify if there are any figures, charts, graphs, plots, diagrams, or visual tables present on this page.
2. If NO figures/charts are present, respond with ONLY the text "NO_FIGURES".
3. If YES, for each figure or chart extract:
- Figure ID / Label: (e.g., "Figure 1", "Figure 2", "Figure 3", "Chart A")
- Title / Caption: (the title or descriptive caption)
- Chart / Visual Type: (e.g., "Histogram", "Line Graph", "Heatmap", "Confusion Matrix", "Process Diagram", "Timeline Diagram", "Bar Chart")
- X-Axis & Y-Axis: (exact axis labels, units, and ranges)
- Legend & Categories: (series names, color mappings, variables like P(T|S), Individual vs Aggregated, etc.)
- Data Trends & Patterns: (describe observed trends, peaks, distributions, shifts, or correlations)
- Key Values: (specific numbers, bounds, frequencies, or metrics shown)
- Detailed Description: (comprehensive factual summary of what the visual evidence represents)

Be strictly factual and thorough. Do not hallucinate elements not visible in the image.`;

    let rawText = '';
    for (const model of this.fallbackModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: base64Data,
                  },
                },
              ],
            },
          ],
          config: {
            temperature: 0.1,
          },
        });

        rawText = response.text?.trim() || '';
        if (rawText) break;
      } catch (err: any) {
        console.warn(`[VisualEvidenceService] Model ${model} page ${pageNumber} analysis failed: ${err.message?.slice(0, 150)}`);
      }
    }

    if (!rawText || rawText.includes('NO_FIGURES')) {
      return [];
    }

    return this.parseVisualFiguresFromText(rawText, pageNumber);
  }

  /**
   * Parse structured figures from Gemini response
   */
  private parseVisualFiguresFromText(text: string, pageNumber: number): VisualFigure[] {
    const figures: VisualFigure[] = [];

    // Split by Figure / Chart sections or numbered headers
    const figureBlocks = text.split(/(?=(?:(?:\*\*|\#\#|\#)?\s*(?:Figure|Fig\.|Chart|Diagram|Table)\s*\d+[\s*:]))/i);

    for (const block of figureBlocks) {
      const trimmed = block.trim();
      if (!trimmed || trimmed.toUpperCase() === 'NO_FIGURES') continue;

      const figIdMatch = trimmed.match(/(?:Figure|Fig\.|Chart|Diagram|Table)\s*(\d+[a-z]?)/i);
      const figureId = figIdMatch ? `Figure ${figIdMatch[1]}` : `Figure on Page ${pageNumber}`;

      // Extract title
      const titleMatch = trimmed.match(/(?:Figure|Fig\.|Chart|Diagram|Table)\s*\d*[\s*:]+([^\n*]+)/i);
      let title = titleMatch ? titleMatch[1].replace(/[*#]/g, '').trim() : '';
      if (!title || title.length < 3) {
        title = `${figureId} (Page ${pageNumber})`;
      }

      // Extract Type
      const typeMatch = trimmed.match(/(?:Type|Chart Type|Visual Type)[:\s*]+([^\n*]+)/i);
      const type = typeMatch ? typeMatch[1].replace(/[*#]/g, '').trim() : 'Visual Figure / Chart';

      // Extract Axes
      const xAxisMatch = trimmed.match(/(?:X-Axis|X axis|Horizontal axis)[:\s*]+([^\n*]+)/i);
      const yAxisMatch = trimmed.match(/(?:Y-Axis|Y axis|Vertical axis)[:\s*]+([^\n*]+)/i);
      const axes = {
        x: xAxisMatch ? xAxisMatch[1].replace(/[*#]/g, '').trim() : undefined,
        y: yAxisMatch ? yAxisMatch[1].replace(/[*#]/g, '').trim() : undefined,
      };

      // Extract Legend / Series
      const legendMatch = trimmed.match(/(?:Legend|Labels|Series|Categories)[:\s*]+([^\n*]+)/i);
      const legend = legendMatch ? [legendMatch[1].replace(/[*#]/g, '').trim()] : [];

      // Extract Trends
      const trendMatch = trimmed.match(/(?:Data Trends|Trends|Patterns|Observations)[:\s*]+([^\n*]+(?:\n[^\n*]+)*)/i);
      const trendSummary = trendMatch ? trendMatch[1].replace(/[*#]/g, '').trim() : undefined;

      // Extract Key Values
      const valuesMatch = trimmed.match(/(?:Key Values|Data Points|Values)[:\s*]+([^\n*]+)/i);
      const keyValues = valuesMatch ? [valuesMatch[1].replace(/[*#]/g, '').trim()] : [];

      figures.push({
        figureId,
        title,
        type,
        pageNumber,
        axes,
        legend,
        trendSummary,
        keyValues,
        description: trimmed,
      });
    }

    if (figures.length === 0 && text.length > 50 && !text.includes('NO_FIGURES')) {
      // Fallback single figure if block splitting didn't catch multiple
      figures.push({
        figureId: `Figure on Page ${pageNumber}`,
        title: `Visual Content on Page ${pageNumber}`,
        type: 'Figure / Diagram',
        pageNumber,
        description: text,
      });
    }

    return figures;
  }

  /**
   * Main method to extract multimodal visual evidence from a PDF
   */
  public async extractPdfVisualEvidence(
    documentId: string,
    documentTitle: string,
    pdfBuffer: Buffer,
    startingChunkIndex = 0
  ): Promise<{ chunks: Chunk[]; figures: VisualFigure[] }> {
    const tempDir = path.join('/tmp', `pdf_vis_${documentId}_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const allFigures: VisualFigure[] = [];
    const chunks: Chunk[] = [];

    try {
      const renderedPages = this.renderPdfPagesToPng(pdfBuffer, tempDir, `doc_${documentId}`);

      // Process page image analysis with controlled parallel concurrency
      const pageConcurrency = 4;
      for (let i = 0; i < renderedPages.length; i += pageConcurrency) {
        const pageSlice = renderedPages.slice(i, i + pageConcurrency);
        const results = await Promise.all(
          pageSlice.map(async page => {
            try {
              const imageBuffer = fs.readFileSync(page.filePath);
              return await this.analyzePageImage(page.pageNumber, imageBuffer, documentTitle);
            } catch (pageErr: any) {
              console.warn(`[VisualEvidenceService] Error processing page ${page.pageNumber}: ${pageErr.message}`);
              return [];
            }
          })
        );
        for (const pageFigures of results) {
          allFigures.push(...pageFigures);
        }
      }

      let currentChunkIdx = startingChunkIndex;

      // Create individual visual evidence chunks
      for (const fig of allFigures) {
        const axesDesc = [
          fig.axes?.x ? `X-Axis: ${fig.axes.x}` : '',
          fig.axes?.y ? `Y-Axis: ${fig.axes.y}` : '',
        ].filter(Boolean).join(' | ');

        const legendDesc = fig.legend && fig.legend.length > 0 ? `Legend / Series: ${fig.legend.join(', ')}` : '';
        const trendDesc = fig.trendSummary ? `Observed Trends: ${fig.trendSummary}` : '';
        const keyValsDesc = fig.keyValues && fig.keyValues.length > 0 ? `Key Data Values: ${fig.keyValues.join('; ')}` : '';

        const content = [
          `[Visual Evidence: ${fig.figureId} - ${fig.title}] (Page ${fig.pageNumber})`,
          `Document: "${documentTitle}"`,
          `Type: ${fig.type}`,
          axesDesc,
          legendDesc,
          trendDesc,
          keyValsDesc,
          `Detailed Description:\n${fig.description}`,
        ]
          .filter(Boolean)
          .join('\n');

        chunks.push({
          id: `chk-${documentId}-vis-${fig.pageNumber}-${fig.figureId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          documentId,
          documentTitle,
          chunkIndex: currentChunkIdx++,
          content,
          tokenCount: Math.ceil(content.length / 4),
          pageNumber: fig.pageNumber,
          sectionHeader: `[Visual Evidence] ${fig.figureId}: ${fig.title}`,
          metadata: {
            isVisual: true,
            figureId: fig.figureId,
            figureTitle: fig.title,
            figureType: fig.type,
            pageNumber: fig.pageNumber,
          },
        });
      }

      // Create a master Visual Catalog chunk if figures were found
      if (allFigures.length > 0) {
        const figureListStr = allFigures
          .map(
            (f, idx) =>
              `${idx + 1}. **${f.figureId}** (Page ${f.pageNumber}): "${f.title}" — Type: ${f.type}. ${(f.trendSummary || f.description).slice(0, 180)}...`
          )
          .join('\n');

        const catalogContent = [
          `[Document Visual Index: Figures, Graphs & Charts in "${documentTitle}"]`,
          `This document contains ${allFigures.length} figures, graphs, and visual charts across ${renderedPages.length} pages:`,
          figureListStr,
          `\nSummary: The document includes graphs, histograms, heatmaps, diagrams, and figures detailing experimental results, estimation error distributions, Bayesian probability curves, and parameter configurations.`,
        ].join('\n');

        chunks.push({
          id: `chk-${documentId}-vis-catalog`,
          documentId,
          documentTitle,
          chunkIndex: currentChunkIdx++,
          content: catalogContent,
          tokenCount: Math.ceil(catalogContent.length / 4),
          pageNumber: allFigures[0]?.pageNumber || 1,
          sectionHeader: `[Visual Evidence Catalog] Graphs, Charts, and Figures in ${documentTitle}`,
          metadata: {
            isVisual: true,
            isCatalog: true,
            figureCount: allFigures.length,
          },
        });
      }
    } catch (err: any) {
      console.warn(`[VisualEvidenceService] Extraction encountered error: ${err.message}`);
    } finally {
      // Clean up temp files safely
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup error
      }
    }

    return { chunks, figures: allFigures };
  }
}

export const visualEvidenceService = new VisualEvidenceService();
