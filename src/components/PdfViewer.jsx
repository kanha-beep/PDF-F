import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.15];
const FIT_WIDTH_SCALE = 0.98;

const buttonClass =
  'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

const activeButtonClass =
  'rounded-xl border border-cyan-400/40 bg-cyan-400/20 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/25';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundZoomStep(value) {
  return Math.round(value * 1000) / 1000;
}

function PdfPageCanvas({
  pdf,
  pageNumber,
  scale,
  fitMode,
  stageWidth,
  rotation,
  onPageMeasure,
  pageRef
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!pdf) {
      return;
    }

    let cancelled = false;
    let renderTask = null;

    const renderPage = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const page = await pdf.getPage(pageNumber);
      if (cancelled) {
        return;
      }

      const naturalViewport = page.getViewport({ scale: 1, rotation });
      onPageMeasure(pageNumber, naturalViewport.width);
      const effectiveScale =
        fitMode === 'width' && stageWidth
          ? Math.max((stageWidth * FIT_WIDTH_SCALE) / naturalViewport.width, 0.1)
          : scale;
      const viewport = page.getViewport({ scale: effectiveScale, rotation });
      const context = canvas.getContext('2d');
      const outputScale = window.devicePixelRatio || 1;
      if (!context) {
        throw new Error('Canvas context is not available.');
      }

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.style.backgroundColor = '#ffffff';

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);

      renderTask = page.render({
        canvasContext: context,
        viewport,
        transform,
        background: 'rgb(255,255,255)'
      });

      await renderTask.promise;
    };

    renderPage().catch((error) => {
      if (error?.name === 'RenderingCancelledException') {
        return;
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [fitMode, onPageMeasure, pageNumber, pdf, rotation, scale, stageWidth]);

  return (
    <div
      ref={pageRef}
      data-page-number={pageNumber}
      className="mb-6 flex w-full justify-center last:mb-10"
    >
      <motion.canvas
        ref={canvasRef}
        className="block bg-white shadow-viewer"
        initial={{ opacity: 0.85, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: 'easeOut' }}
      />
    </div>
  );
}

export function PdfViewer({ file, onClose, isFullscreenActive, onEnterFullscreen }) {
  const viewerScrollRef = useRef(null);
  const pdfDocRef = useRef(null);
  const pageRefs = useRef({});
  const lastLeavingRatioRef = useRef(0);
  const pageRatiosRef = useRef({});
  const pageBaseWidthsRef = useRef({});
  const pendingNavigationRef = useRef(null);
  const suppressScrollSyncRef = useRef(false);
  const navigationTimeoutRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState('');
  const [fitMode, setFitMode] = useState('width');
  const [stageWidth, setStageWidth] = useState(0);
  const [learnHidden, setLearnHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;

    setError('');
    setPageCount(0);
    setPageNumber(1);
    setZoom(1);
    setRotation(0);
    setFitMode('width');
    setPdfDoc(null);
    pageRatiosRef.current = {};
    pageRefs.current = {};
    pageBaseWidthsRef.current = {};
    pendingNavigationRef.current = null;
    suppressScrollSyncRef.current = false;
    lastLeavingRatioRef.current = 0;

    const loadPdf = async () => {
      try {
        const buffer = await file.arrayBuffer();
        if (cancelled) {
          return;
        }

        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buffer)
        });

        const pdf = await loadingTask.promise;
        if (cancelled) {
          return;
        }

        pdfDocRef.current = pdf;
        setPdfDoc(pdf);
        setPageCount(pdf.numPages);
      } catch {
        if (!cancelled) {
          setError('Unable to open this PDF file.');
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (navigationTimeoutRef.current) {
        window.clearTimeout(navigationTimeoutRef.current);
        navigationTimeoutRef.current = null;
      }
      loadingTask?.destroy();
      pdfDocRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    const scrollBox = viewerScrollRef.current;
    if (!scrollBox) {
      return;
    }

    const updateStageWidth = () => {
      const scrollBoxStyles = window.getComputedStyle(scrollBox);
      const horizontalPadding =
        Number.parseFloat(scrollBoxStyles.paddingLeft || '0') +
        Number.parseFloat(scrollBoxStyles.paddingRight || '0');
      setStageWidth(Math.max(scrollBox.clientWidth - horizontalPadding, 0));
    };

    updateStageWidth();

    const resizeObserver = new ResizeObserver(() => {
      updateStageWidth();
    });
    resizeObserver.observe(scrollBox);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const pageScale = useMemo(() => {
    return fitMode === 'free' ? zoom : 1;
  }, [fitMode, zoom]);

  const fitWidthZoom = useMemo(() => {
    const currentPageBaseWidth = pageBaseWidthsRef.current[pageNumber];
    if (!currentPageBaseWidth || !stageWidth) {
      return null;
    }

    return Math.max((stageWidth * FIT_WIDTH_SCALE) / currentPageBaseWidth, 0.1);
  }, [pageCount, pageNumber, pdfDoc, rotation, stageWidth]);

  const zoomSteps = useMemo(() => {
    const steps = fitWidthZoom ? [...ZOOM_STEPS, fitWidthZoom] : ZOOM_STEPS;
    return [...new Set(steps.map(roundZoomStep))].sort((left, right) => left - right);
  }, [fitWidthZoom]);

  const zoomLabel = useMemo(() => {
    if (fitMode === 'width') {
      return fitWidthZoom ? `Fit Width (${Math.round(fitWidthZoom * 100)}%)` : 'Fit Width';
    }

    return `${Math.round(zoom * 100)}%`;
  }, [fitMode, fitWidthZoom, zoom]);

  const releaseScrollSync = () => {
    if (navigationTimeoutRef.current) {
      window.clearTimeout(navigationTimeoutRef.current);
    }

    navigationTimeoutRef.current = window.setTimeout(() => {
      suppressScrollSyncRef.current = false;
      pendingNavigationRef.current = null;
    }, 420);
  };

  useLayoutEffect(() => {
    const pendingNavigation = pendingNavigationRef.current;
    if (!pendingNavigation || pendingNavigation.pageNumber !== pageNumber) {
      return;
    }

    const scrollBox = viewerScrollRef.current;
    const pageElement = pageRefs.current[pageNumber];
    if (!scrollBox || !pageElement) {
      return;
    }

    requestAnimationFrame(() => {
      const viewportHeight = scrollBox.clientHeight;
      const pageHeight = pageElement.offsetHeight;
      const pageTop = pageElement.offsetTop;
      const availableScrollInsidePage = Math.max(pageHeight - viewportHeight, 0);
      const storedRatio = pageRatiosRef.current[pageNumber] ?? 0;
      const nextTop = pageTop + availableScrollInsidePage * storedRatio;

      scrollBox.scrollTo({
        top: nextTop,
        behavior: pendingNavigation.behavior
      });
      releaseScrollSync();
    });
  }, [pageNumber, pageScale, rotation]);

  useEffect(() => {
    const scrollBox = viewerScrollRef.current;
    if (!scrollBox || !pageCount) {
      return;
    }

    const handleScroll = () => {
      if (suppressScrollSyncRef.current) {
        return;
      }

      const viewportMiddle = scrollBox.scrollTop + scrollBox.clientHeight / 2;
      let closestPage = pageNumber;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (let nextPage = 1; nextPage <= pageCount; nextPage += 1) {
        const pageElement = pageRefs.current[nextPage];
        if (!pageElement) {
          continue;
        }

        const pageMiddle = pageElement.offsetTop + pageElement.offsetHeight / 2;
        const distance = Math.abs(pageMiddle - viewportMiddle);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = nextPage;
        }
      }

      setPageNumber((currentPage) => (currentPage === closestPage ? currentPage : closestPage));
    };

    scrollBox.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      scrollBox.removeEventListener('scroll', handleScroll);
    };
  }, [pageCount, pageNumber, pageScale, rotation]);

  const rememberCurrentPageRatio = () => {
    const scrollBox = viewerScrollRef.current;
    const pageElement = pageRefs.current[pageNumber];
    if (!scrollBox || !pageElement) {
      return 0;
    }

    const pageTop = pageElement.offsetTop;
    const pageHeight = pageElement.offsetHeight;
    const viewportHeight = scrollBox.clientHeight;
    const availableScrollInsidePage = Math.max(pageHeight - viewportHeight, 0);
    const relativeScroll = scrollBox.scrollTop - pageTop;
    const ratio =
      availableScrollInsidePage === 0
        ? 0
        : clamp(relativeScroll / availableScrollInsidePage, 0, 1);

    pageRatiosRef.current[pageNumber] = ratio;
    lastLeavingRatioRef.current = ratio;
    return ratio;
  };

  const goToPage = (targetPage, behavior = 'auto') => {
    if (!pageCount) {
      return;
    }

    const nextPageNumber = clamp(targetPage, 1, pageCount);
    rememberCurrentPageRatio();
    pendingNavigationRef.current = {
      pageNumber: nextPageNumber,
      behavior
    };
    suppressScrollSyncRef.current = true;
    setPageNumber(nextPageNumber);
  };

  const adjustZoom = (direction) => {
    const currentZoom =
      fitMode === 'width' && fitWidthZoom ? roundZoomStep(fitWidthZoom) : roundZoomStep(zoom);
    setFitMode('free');
    const currentStep = currentZoom;
    const fallbackIndex = zoomSteps.findIndex((step) => step >= currentStep);
    const currentIndex = fallbackIndex === -1 ? zoomSteps.length - 1 : fallbackIndex;
    if (direction === 'in') {
      const nextIndex = clamp(currentIndex + 1, 0, zoomSteps.length - 1);
      setZoom(zoomSteps[nextIndex]);
      return;
    }

    const nextIndex = clamp(currentIndex - 1, 0, zoomSteps.length - 1);
    setZoom(zoomSteps[nextIndex]);
  };

  const handlePageInput = (event) => {
    const parsed = Number(event.target.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    goToPage(parsed);
  };

  const handlePageMeasure = (targetPageNumber, nextWidth) => {
    pageBaseWidthsRef.current[targetPageNumber] = nextWidth;
  };

  const jumpToPageSection = (targetPageNumber, ratio) => {
    const scrollBox = viewerScrollRef.current;
    const pageElement = pageRefs.current[targetPageNumber];
    if (!scrollBox || !pageElement) {
      return;
    }

    const viewportHeight = scrollBox.clientHeight;
    const pageHeight = pageElement.offsetHeight;
    const pageTop = pageElement.offsetTop;
    const availableScrollInsidePage = Math.max(pageHeight - viewportHeight, 0);
    const nextRatio = clamp(ratio, 0, 1);

    pageRatiosRef.current[targetPageNumber] = nextRatio;
    if (targetPageNumber === pageNumber) {
      lastLeavingRatioRef.current = nextRatio;
    }

    suppressScrollSyncRef.current = true;
    scrollBox.scrollTo({
      top: pageTop + availableScrollInsidePage * nextRatio,
      behavior: 'auto'
    });
    releaseScrollSync();
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      const targetTag = event.target?.tagName;
      const isTypingField =
        targetTag === 'INPUT' || targetTag === 'TEXTAREA' || event.target?.isContentEditable;

      if (isTypingField) {
        return;
      }

      if (event.ctrlKey && event.key === 'ArrowUp') {
        event.preventDefault();
        jumpToPageSection(pageNumber, 0);
        return;
      }

      if (event.ctrlKey && event.key === 'ArrowDown') {
        event.preventDefault();
        jumpToPageSection(pageNumber, 1);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goToPage(pageNumber + 1);
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goToPage(pageNumber - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageCount, pageNumber]);

  useEffect(() => {
    return () => {
      if (navigationTimeoutRef.current) {
        window.clearTimeout(navigationTimeoutRef.current);
      }
    };
  }, []);

  return (
    <motion.section
      className="fixed inset-0 z-[100] flex flex-col text-slate-100"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <motion.header
        className="border-b border-white/10 bg-slate-950/95 px-3 py-3 backdrop-blur sm:px-4"
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -12, opacity: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() => goToPage(pageNumber - 1)}
              disabled={pageNumber <= 1}
            >
              Prev
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100">
              <input
                type="number"
                min="1"
                max={pageCount || 1}
                value={pageNumber}
                onChange={handlePageInput}
                className="w-16 border-0 bg-transparent text-center text-sm text-white outline-none"
              />
              <span>/ {pageCount || '--'}</span>
            </div>
            <button
              type="button"
              className={buttonClass}
              onClick={() => goToPage(pageNumber + 1)}
              disabled={pageNumber >= pageCount}
            >
              Next
            </button>
          </div>

          <div className="flex justify-center text-semibold">
            <button
              type="button"
              className={learnHidden ? activeButtonClass : buttonClass}
              onClick={() => setLearnHidden((value) => !value)}
            >
              Learn
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {!isFullscreenActive ? (
              <button type="button" className={buttonClass} onClick={onEnterFullscreen}>
                Enter Full Screen
              </button>
            ) : null}
            <button type="button" className={buttonClass} onClick={() => adjustZoom('out')}>
              Zoom -
            </button>
            <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
              {zoomLabel}
            </span>
            <button type="button" className={buttonClass} onClick={() => adjustZoom('in')}>
              Zoom +
            </button>
            <button
              type="button"
              className={fitMode === 'width' ? activeButtonClass : buttonClass}
              onClick={() => setFitMode('width')}
            >
              Fit Width
            </button>
            <button
              type="button"
              className={fitMode === 'free' ? activeButtonClass : buttonClass}
              onClick={() => setFitMode('free')}
            >
              Free Zoom
            </button>
            {/* <button
              type="button"
              className={buttonClass}
              onClick={() => setRotation((value) => (value + 90) % 360)}
            >
              Rotate
            </button> */}
            <button type="button" className={buttonClass} onClick={onClose}>
              Exit
            </button>
          </div>
        </div>
      </motion.header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <motion.div
          className="relative flex-1 overflow-y-auto overflow-x-hidden bg-gradient-to-b from-slate-900 to-slate-950 py-6 sm:py-8 lg:py-10"
          ref={viewerScrollRef}
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.99 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          <AnimatePresence>
            {error ? (
              <motion.div
                className="fixed bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-rose-200 px-4 py-2 text-sm font-medium text-rose-900 shadow-lg"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
              >
                {error}
              </motion.div>
            ) : null}
          </AnimatePresence>
          {pdfDoc && pageCount ? (
            Array.from({ length: pageCount }, (_, index) => {
              const nextPageNumber = index + 1;
              return (
                <PdfPageCanvas
                  key={`${nextPageNumber}-${rotation}-${fitMode}-${zoom}-${stageWidth}`}
                  pdf={pdfDoc}
                  pageNumber={nextPageNumber}
                  scale={pageScale}
                  fitMode={fitMode}
                  stageWidth={stageWidth}
                  rotation={rotation}
                  onPageMeasure={handlePageMeasure}
                  pageRef={(element) => {
                    pageRefs.current[nextPageNumber] = element;
                  }}
                />
              );
            })
          ) : null}
        </motion.div>
        {learnHidden ? (
          <div className="pointer-events-none absolute inset-0 z-20 bg-black/95" />
        ) : null}
      </div>
    </motion.section>
  );
}
