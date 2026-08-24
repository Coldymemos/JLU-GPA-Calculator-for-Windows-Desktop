function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export interface RenderedResult {
  fileName: string;
  dataUrl: string;
}

/** 渲染结果卡片为 PNG dataURL（不触发下载；下载/直写由调用方决定） */
export async function renderResultPng(element: HTMLElement): Promise<RenderedResult> {
  const { toPng } = await import('html-to-image');
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true
  });
  return { fileName: `JLU-GPA-${timestamp()}.png`, dataUrl };
}

/** 渲染结果卡片为 PDF dataURL（不触发下载；下载/直写由调用方决定） */
export async function renderResultPdf(element: HTMLElement): Promise<RenderedResult> {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const dataUrl = await toPng(element, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    cacheBust: true
  });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 12;
  const width = 210 - margin * 2;
  const image = document.createElement('img');
  image.src = dataUrl;
  await image.decode();
  const height = (image.height * width) / image.width;
  pdf.addImage(dataUrl, 'PNG', margin, margin, width, Math.min(height, 297 - margin * 2));
  const pdfBytes = pdf.output('arraybuffer');
  const base64 = bytesToBase64(new Uint8Array(pdfBytes));
  return {
    fileName: `JLU-GPA-${timestamp()}.pdf`,
    dataUrl: `data:application/pdf;base64,${base64}`
  };
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? (dataUrl.split(',')[1] ?? '') : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
