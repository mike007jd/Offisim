import PptxGenJS from 'pptxgenjs';
import type { ExportResult, ExportableDocument, Exporter } from './types.js';
import { formatDate, sanitizeFilename } from './utils.js';

export const pptxExporter: Exporter = {
  async export(doc: ExportableDocument): Promise<ExportResult> {
    const pptx = new PptxGenJS();
    pptx.title = doc.title;
    pptx.author = doc.contributors.map((c) => c.name).join(', ');

    const date = formatDate(doc.createdAt);
    const contributorText = doc.contributors.map((c) => c.name).join(', ');

    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.addText(doc.title, {
      x: 0.5,
      y: 1.5,
      w: 9,
      h: 1.5,
      fontSize: 36,
      bold: true,
      align: 'center',
      color: '1a1a1a',
    });
    titleSlide.addText(`${date}\nContributors: ${contributorText || 'N/A'}`, {
      x: 0.5,
      y: 3.2,
      w: 9,
      h: 1,
      fontSize: 14,
      align: 'center',
      color: '666666',
    });

    // Split content by ## headers into slides
    const sections = splitIntoSlides(doc.content);
    for (const section of sections) {
      const slide = pptx.addSlide();
      if (section.heading) {
        slide.addText(section.heading, {
          x: 0.5,
          y: 0.3,
          w: 9,
          h: 0.8,
          fontSize: 24,
          bold: true,
          color: '1a1a1a',
        });
      }
      if (section.body) {
        slide.addText(section.body, {
          x: 0.5,
          y: section.heading ? 1.3 : 0.5,
          w: 9,
          h: 4.5,
          fontSize: 16,
          color: '333333',
          valign: 'top',
        });
      }
    }

    // If no content sections were created, add a single content slide
    if (sections.length === 0 && doc.content.trim()) {
      const slide = pptx.addSlide();
      slide.addText(doc.content, {
        x: 0.5,
        y: 0.5,
        w: 9,
        h: 5,
        fontSize: 16,
        color: '333333',
        valign: 'top',
      });
    }

    const output = (await pptx.write({ outputType: 'blob' })) as Blob;
    return {
      blob: output,
      filename: `${sanitizeFilename(doc.title)}.pptx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
  },
};

interface SlideSection {
  heading: string;
  body: string;
}

function splitIntoSlides(content: string): SlideSection[] {
  const sections: SlideSection[] = [];
  // Split by lines that start with ## (but not ### or more)
  const lines = content.split('\n');
  let currentHeading = '';
  let currentBody: string[] = [];

  for (const line of lines) {
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      // Flush previous section
      if (currentHeading || currentBody.length > 0) {
        sections.push({
          heading: currentHeading,
          body: currentBody.join('\n').trim(),
        });
      }
      currentHeading = line.replace(/^##\s+/, '');
      currentBody = [];
    } else {
      // Skip top-level # heading (already in title slide)
      if (/^#\s+/.test(line)) continue;
      currentBody.push(line);
    }
  }

  // Flush last section
  if (currentHeading || currentBody.length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentBody.join('\n').trim(),
    });
  }

  return sections;
}
