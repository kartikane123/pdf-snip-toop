import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import { Upload, Crop, ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PdfPage = React.memo(({ pdfDoc, pageNumber, scale }: { pdfDoc: pdfjsLib.PDFDocumentProxy, pageNumber: number, scale: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let isMounted = true;

    const renderPage = async () => {
      // If a render is already in progress, cancel it and wait for it to fully abort
      // before starting a new render on the same canvas.
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        try {
          await renderTaskRef.current.promise;
        } catch (e) {
          // Ignore cancellation error
        }
      }

      if (!isMounted || !canvasRef.current) return;

      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = { canvasContext: context, viewport };
        renderTaskRef.current = page.render(renderContext);
        
        await renderTaskRef.current.promise;
      } catch (err: any) {
        if (err?.name === 'RenderingCancelledException' || err instanceof pdfjsLib.RenderingCancelledException) {
          // ignore
        } else {
          console.error("Render error:", err);
        }
      }
    };

    renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div className="mb-6 shadow-lg bg-white">
      <canvas ref={canvasRef} className="pdf-page-canvas block max-w-full" />
    </div>
  );
});

export default function App() {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);

  const [isSnipping, setIsSnipping] = useState(false);
  const [snipStart, setSnipStart] = useState<{ x: number; y: number } | null>(null);
  const [snipEnd, setSnipEnd] = useState<{ x: number; y: number } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileUrl = URL.createObjectURL(file);
    try {
      const loadingTask = pdfjsLib.getDocument(fileUrl);
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setIsSnipping(false);
    } catch (err) {
      console.error("Error loading PDF:", err);
      alert("Failed to load PDF file.");
    }
  };

  const performTextSearch = async (dataUrl: string) => {
    setIsExtracting(true);
    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(dataUrl);
      await worker.terminate();
      const text = ret.data.text.trim();

      if (text) {
        window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank');
      } else {
        alert("No text found in the snip. Please try snipping a clearer area.");
      }
    } catch (err) {
      console.error("OCR Error:", err);
      alert("Failed to extract text from the image.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setSnipStart({ x: e.clientX, y: e.clientY });
    setSnipEnd(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!snipStart) return;
    setSnipEnd({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!snipStart) return;
    const end = { x: e.clientX, y: e.clientY };
    setSnipEnd(end);

    const x1 = Math.min(snipStart.x, end.x);
    const y1 = Math.min(snipStart.y, end.y);
    const w = Math.abs(snipStart.x - end.x);
    const h = Math.abs(snipStart.y - end.y);

    if (w > 20 && h > 20) {
      const snipCanvas = document.createElement('canvas');
      snipCanvas.width = w;
      snipCanvas.height = h;
      const ctx = snipCanvas.getContext('2d');

      const canvases = document.querySelectorAll('.pdf-page-canvas');
      canvases.forEach((canvas: any) => {
        const rect = canvas.getBoundingClientRect();
        const intersectX = Math.max(x1, rect.left);
        const intersectY = Math.max(y1, rect.top);
        const intersectW = Math.min(x1 + w, rect.right) - intersectX;
        const intersectH = Math.min(y1 + h, rect.bottom) - intersectY;

        if (intersectW > 0 && intersectH > 0) {
          const sx = intersectX - rect.left;
          const sy = intersectY - rect.top;
          const dx = intersectX - x1;
          const dy = intersectY - y1;

          const scaleX = canvas.width / rect.width;
          const scaleY = canvas.height / rect.height;

          ctx?.drawImage(
            canvas,
            sx * scaleX, sy * scaleY, intersectW * scaleX, intersectH * scaleY,
            dx, dy, intersectW, intersectH
          );
        }
      });

      const dataUrl = snipCanvas.toDataURL('image/png');
      performTextSearch(dataUrl);
    }

    setSnipStart(null);
    setSnipEnd(null);
    setIsSnipping(false);
  };

  return (
    <div className="min-h-screen bg-neutral-200 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-neutral-300 px-4 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-4">
          <h1 className="font-bold text-lg text-neutral-800 hidden sm:block">PDF Text Searcher</h1>
          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg cursor-pointer transition-colors text-sm font-medium">
            <Upload className="w-4 h-4" />
            Upload PDF
            <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
          </label>
        </div>

        {pdfDoc && (
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 bg-neutral-100 rounded-lg p-1">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className="p-1.5 hover:bg-white rounded text-neutral-600 hover:text-neutral-900 transition-colors" title="Zoom Out">
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs font-medium text-neutral-500 w-12 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="p-1.5 hover:bg-white rounded text-neutral-600 hover:text-neutral-900 transition-colors" title="Zoom In">
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            <div className="h-6 w-px bg-neutral-300"></div>

            <button
              onClick={() => {
                setIsSnipping(!isSnipping);
                setSnipStart(null);
                setSnipEnd(null);
              }}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                isSnipping ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              )}
            >
              <Crop className="w-4 h-4" />
              {isSnipping ? "Cancel Snip" : "Snip Text"}
            </button>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4 md:p-8 flex flex-col items-center relative">
        {!pdfDoc ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400 mt-20">
            <div className="w-24 h-24 bg-neutral-300 rounded-full flex items-center justify-center mb-6">
              <Upload className="w-10 h-10 text-neutral-500" />
            </div>
            <h2 className="text-xl font-semibold text-neutral-700 mb-2">No PDF Loaded</h2>
            <p className="text-neutral-500 text-center max-w-md">
              Upload a PDF document to start reading. Use the snip tool to capture text and search it instantly on Google.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center w-full">
            {Array.from({ length: numPages }, (_, i) => (
              <PdfPage key={i + 1} pdfDoc={pdfDoc} pageNumber={i + 1} scale={scale} />
            ))}
          </div>
        )}
      </main>

      {/* Snipping Overlay */}
      {isSnipping && (
        <div
          className="fixed inset-0 z-50 cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="absolute inset-0 bg-black/10" />
          {snipStart && snipEnd && (
            <div
              className="absolute border-2 border-emerald-500 bg-emerald-500/20 pointer-events-none"
              style={{
                left: Math.min(snipStart.x, snipEnd.x),
                top: Math.min(snipStart.y, snipEnd.y),
                width: Math.abs(snipStart.x - snipEnd.x),
                height: Math.abs(snipStart.y - snipEnd.y),
              }}
            />
          )}
        </div>
      )}

      {/* Loading Overlay */}
      {isExtracting && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex flex-col items-center justify-center text-white backdrop-blur-sm">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-indigo-400" />
          <h2 className="text-xl font-semibold">Extracting text...</h2>
          <p className="text-neutral-300 mt-2">Searching Google in a moment.</p>
        </div>
      )}
    </div>
  );
}
