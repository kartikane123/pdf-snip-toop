import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';
import { 
  Upload, Crop, ZoomIn, ZoomOut, Loader2, 
  History, Moon, Sun, Navigation, 
  Trash2, ExternalLink, X, MoveUp, Search
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useLocalStorage } from 'react-use';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface HistoryItem {
  id: string;
  text: string;
  timestamp: number;
}

const PdfPage = React.memo(({ 
  pdfDoc, 
  pageNumber, 
  scale, 
  isDarkMode 
}: { 
  pdfDoc: pdfjsLib.PDFDocumentProxy, 
  pageNumber: number, 
  scale: number,
  isDarkMode: boolean
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '1000px' }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const getPageDims = async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        setDimensions({ width: viewport.width, height: viewport.height });
      } catch (e) {
        console.error("Dim load error:", e);
      }
    };
    getPageDims();
  }, [pdfDoc, pageNumber]);

  useEffect(() => {
    let isMounted = true;
    if (!inView || !pdfDoc) return;

    const renderPage = async () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        try { await renderTaskRef.current.promise; } catch (e) {}
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

        const renderContext = { 
          canvasContext: context, 
          viewport,
          background: isDarkMode ? 'transparent' : 'white' 
        };
        renderTaskRef.current = page.render(renderContext);
        await renderTaskRef.current.promise;

        if (isDarkMode && canvas) {
          context.globalCompositeOperation = 'difference';
          context.fillStyle = 'white';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = 'source-over';
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error("Render error:", err);
        }
      }
    };

    renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) renderTaskRef.current.cancel();
    };
  }, [pdfDoc, pageNumber, scale, inView, isDarkMode]);

  const style = useMemo(() => {
    if (!dimensions) return { height: '800px', width: '100%', maxWidth: '800px' };
    return {
      width: dimensions.width * scale,
      height: dimensions.height * scale,
    };
  }, [dimensions, scale]);

  return (
    <div 
      ref={containerRef}
      id={`page-${pageNumber}`}
      className={cn(
        "mb-8 shadow-sm transition-opacity duration-300 relative",
        isDarkMode ? "bg-neutral-800" : "bg-white border text-black",
        !inView && "opacity-50"
      )}
      style={style}
    >
      <div className="absolute top-2 left-2 z-10 text-[10px] bg-black/20 px-1 rounded backdrop-blur text-white opacity-50">
        Page {pageNumber}
      </div>
      {inView ? (
        <canvas ref={canvasRef} className="pdf-page-canvas block w-full h-full" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-neutral-500">
           <Loader2 className="animate-spin mb-2 w-4 h-4 opacity-20" />
           <span className="text-[10px] font-medium opacity-30">P{pageNumber}</span>
        </div>
      )}
    </div>
  );
});

export default function App() {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [isDarkMode, setIsDarkMode] = useLocalStorage('jee_dark_mode', false);
  const [history, setHistory] = useLocalStorage<HistoryItem[]>('jee_search_history', []);
  const [showHistory, setShowHistory] = useState(false);
  const [jumpTo, setJumpTo] = useState('');
  const [isOver, setIsOver] = useState(false);

  const [isSnipping, setIsSnipping] = useState(false);
  const [snipStart, setSnipStart] = useState<{ x: number; y: number } | null>(null);
  const [snipEnd, setSnipEnd] = useState<{ x: number; y: number } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      alert("Please upload a valid PDF file.");
      return;
    }
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files[0]) handleFileUpload(files[0]);
  };

  const performTextSearch = async (dataUrl: string) => {
    setIsExtracting(true);
    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(dataUrl);
      await worker.terminate();
      const text = ret.data.text.trim().replace(/\n/g, ' ');

      if (text) {
        const newItem: HistoryItem = {
          id: Date.now().toString(),
          text,
          timestamp: Date.now()
        };
        setHistory([newItem, ...(history || []).slice(0, 49)]);
        window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank');
      } else {
        alert("No text found in the snip.");
      }
    } catch (err) {
      console.error("OCR Error:", err);
      alert("Failed to extract text.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isSnipping) return;
    setSnipStart({ x: e.clientX, y: e.clientY });
    setSnipEnd(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!snipStart || !isSnipping) return;
    setSnipEnd({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!snipStart || !isSnipping) return;
    const end = { x: e.clientX, y: e.clientY };
    setSnipEnd(end);

    const x1 = Math.min(snipStart.x, end.x);
    const y1 = Math.min(snipStart.y, end.y);
    const w = Math.abs(snipStart.x - end.x);
    const h = Math.abs(snipStart.y - end.y);

    if (w > 10 && h > 10) {
      const snipCanvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      snipCanvas.width = w * dpr;
      snipCanvas.height = h * dpr;
      const ctx = snipCanvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      const canvases = document.querySelectorAll('.pdf-page-canvas');
      canvases.forEach((canvas: any) => {
        const rect = canvas.getBoundingClientRect();
        const intersectX = Math.max(x1, rect.left);
        const intersectY = Math.max(y1, rect.top);
        const intersectW = Math.min(x1 + w, rect.right) - intersectX;
        const intersectH = Math.min(y1 + h, rect.bottom) - intersectY;

        if (intersectW > 0 && intersectH > 0) {
          const sx = (intersectX - rect.left) * (canvas.width / rect.width);
          const sy = (intersectY - rect.top) * (canvas.height / rect.height);
          const dx = intersectX - x1;
          const dy = intersectY - y1;

          ctx.drawImage(
            canvas,
            sx, sy, intersectW * (canvas.width / rect.width), intersectH * (canvas.height / rect.height),
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

  const handleJumpTo = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpTo);
    if (pageNum > 0 && pageNum <= numPages) {
      const element = document.getElementById(`page-${pageNum}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    setJumpTo('');
  };

  return (
    <div 
      className={cn(
        "min-h-screen flex flex-col font-sans transition-colors duration-200",
        isDarkMode ? "bg-neutral-900 text-neutral-100" : "bg-neutral-100 text-neutral-900"
      )}
      onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className={cn(
        "border-b px-4 py-2 flex items-center justify-between sticky top-0 z-40 shadow-sm transition-colors",
        isDarkMode ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200"
      )}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg tracking-tight hidden sm:block">JEE Prep</h1>
            <span className="text-[10px] font-bold uppercase bg-indigo-600 text-white px-1.5 py-0.5 rounded">PDF</span>
          </div>
          
          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg cursor-pointer transition-colors text-sm font-medium">
            <Upload className="w-4 h-4" />
            <span className="hidden md:inline">Upload Module</span>
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])} />
          </label>
        </div>

        {pdfDoc && (
          <div className="flex items-center gap-2 md:gap-4">
            <form onSubmit={handleJumpTo} className="relative hidden md:flex items-center">
              <Navigation className="absolute left-2.5 w-3.5 h-3.5 text-neutral-400" />
              <input 
                type="number"
                placeholder="Page..."
                value={jumpTo}
                onChange={(e) => setJumpTo(e.target.value)}
                className={cn(
                  "pl-8 pr-3 py-1.5 rounded-lg text-sm w-24 outline-none border transition-colors",
                  isDarkMode ? "bg-neutral-700 border-neutral-600 text-white" : "bg-neutral-100 border-neutral-200"
                )}
              />
            </form>

            <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-700 rounded-lg p-1 border dark:border-neutral-600">
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))} className="p-1 px-2 hover:bg-white dark:hover:bg-neutral-600 rounded text-neutral-600 dark:text-neutral-300 text-xs">-</button>
              <span className="text-[10px] font-mono w-10 text-center">{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale(s => Math.min(3, s + 0.25))} className="p-1 px-2 hover:bg-white dark:hover:bg-neutral-600 rounded text-neutral-600 dark:text-neutral-300 text-xs">+</button>
            </div>

            <button
              onClick={() => { setIsSnipping(!isSnipping); setSnipStart(null); setSnipEnd(null); }}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm",
                isSnipping ? "bg-red-500 text-white animate-pulse" : "bg-emerald-600 text-white hover:bg-emerald-700"
              )}
            >
              <Crop className="w-4 h-4" />
              <span className="hidden md:inline">{isSnipping ? "Stop" : "Snip"}</span>
            </button>

            <button onClick={() => setShowHistory(!showHistory)} className={cn("p-2 rounded-lg border", showHistory ? "bg-indigo-50 border-indigo-200 text-indigo-600" : isDarkMode ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200")}>
              <History className="w-4 h-4 text-neutral-500" />
            </button>

            <button onClick={() => setIsDarkMode(!isDarkMode)} className={cn("p-2 rounded-lg border", isDarkMode ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200")}>
              {isDarkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-neutral-500" />}
            </button>
          </div>
        )}
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 overflow-auto p-4 md:p-8 flex flex-col items-center relative custom-scrollbar">
          {!pdfDoc ? (
            <div className={cn(
              "flex flex-col items-center justify-center min-h-[60vh] rounded-3xl w-full max-w-4xl border-4 border-dashed transition-all mt-10",
              isOver ? "border-indigo-500 bg-indigo-50/10 scale-[1.02]" : isDarkMode ? "border-neutral-800" : "border-neutral-200"
            )}>
              <Upload className="w-12 h-12 mb-6 opacity-20" />
              <h2 className="text-2xl font-bold mb-2">Drop your Module</h2>
              <p className="text-center max-w-sm px-4 opacity-70 mb-8">
                Optimized for large 1000+ page JEE modules.
              </p>
              <button 
                onClick={() => (document.querySelector('input[type="file"]') as HTMLInputElement)?.click()}
                className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg"
              >
                Select PDF
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center w-full max-w-full">
              {Array.from({ length: numPages }, (_, i) => (
                <PdfPage key={i + 1} pdfDoc={pdfDoc} pageNumber={i + 1} scale={scale} isDarkMode={!!isDarkMode} />
              ))}
            </div>
          )}
          
          {pdfDoc && (
             <button 
               onClick={() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })}
               className="fixed bottom-6 right-6 p-3 bg-neutral-800 text-white rounded-full shadow-2xl opacity-60 hover:opacity-100 transition-opacity z-30"
             >
               <MoveUp className="w-5 h-5" />
             </button>
          )}
        </main>

        {/* History Sidebar */}
        {showHistory && (
          <aside className={cn(
            "w-80 h-full border-l flex flex-col transition-all z-50 fixed right-0 top-0 bottom-0 md:relative",
            isDarkMode ? "bg-neutral-800 border-neutral-700" : "bg-white border-neutral-200 shadow-2xl"
          )}>
            <div className="p-4 border-b flex items-center justify-between">
              <span className="font-bold">History</span>
              <button onClick={() => setShowHistory(false)}><X className="w-4 h-4" /></button>
            </div>
            
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {history && history.length > 0 ? history.map((item) => (
                <div key={item.id} className={cn("p-3 rounded-lg border text-xs", isDarkMode ? "bg-neutral-900 border-neutral-700" : "bg-neutral-50 border-neutral-200")}>
                  <p className="line-clamp-2 mb-2 italic">"{item.text}"</p>
                  <button 
                    onClick={() => window.open(`https://www.google.com/search?q=${encodeURIComponent(item.text)}`, '_blank')}
                    className="text-indigo-500 font-bold hover:underline py-1 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> SEARCH
                  </button>
                </div>
              )) : <div className="text-center opacity-30 mt-10 text-xs">No history</div>}
            </div>
            <button onClick={() => setHistory([])} className="m-4 text-[10px] text-red-500 hover:underline">Clear History</button>
          </aside>
        )}
      </div>

      {/* Snipping Overlay */}
      {isSnipping && (
        <div
          className="fixed inset-0 z-50 cursor-crosshair select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="absolute inset-0 bg-black/30" />
          {snipStart && snipEnd && (
            <div
              className="absolute border-2 border-dashed border-white shadow-[0_0_0_2000px_rgba(0,0,0,0.5)] bg-transparent pointer-events-none"
              style={{
                left: Math.min(snipStart.x, snipEnd.x),
                top: Math.min(snipStart.y, snipEnd.y),
                width: Math.abs(snipStart.x - snipEnd.x),
                height: Math.abs(snipStart.y - snipEnd.y),
              }}
            />
          )}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 bg-white dark:bg-neutral-800 px-6 py-2 rounded-full shadow-2xl font-bold text-sm">
             Select Question Area
          </div>
        </div>
      )}

      {isExtracting && (
        <div className="fixed inset-0 z-[60] bg-neutral-900/90 flex flex-col items-center justify-center text-white backdrop-blur-lg">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-500 mb-4" />
          <h2 className="text-xl font-bold tracking-tight">JEE Question Processor</h2>
          <p className="text-neutral-400 text-sm mt-2 font-mono">Extracting text...</p>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      `}} />
    </div>
  );
}

function Search({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
  );
}
