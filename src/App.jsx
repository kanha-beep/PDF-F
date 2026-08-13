import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PdfViewer } from './components/PdfViewer';
import { Analytics } from "@vercel/analytics/next"
const RECENT_FILES_KEY = 'pdf-viewer-recent-files';
const TRACKED_SECTIONS = ['quick-open', 'what-we-are', 'services', 'features'];
const API_BASE_URL = import.meta.env.VITE_API_URL;

function formatFileSize(size) {
  if (!size) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let nextSize = size;
  let unitIndex = 0;

  while (nextSize >= 1024 && unitIndex < units.length - 1) {
    nextSize /= 1024;
    unitIndex += 1;
  }

  return `${nextSize.toFixed(nextSize >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatOpenedAt(timestamp) {
  if (!timestamp) {
    return 'Just now';
  }

  return new Date(timestamp).toLocaleString();
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState(() =>
    typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false
  );
  const [recentFiles, setRecentFiles] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState(TRACKED_SECTIONS[0]);
  const [hiddenSections, setHiddenSections] = useState({});
  const [serverStatus, setServerStatus] = useState('Checking server...');
  const fileInputRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    const savedRecentFiles = window.localStorage.getItem(RECENT_FILES_KEY);
    if (!savedRecentFiles) {
      return;
    }

    try {
      setRecentFiles(JSON.parse(savedRecentFiles));
    } catch {
      window.localStorage.removeItem(RECENT_FILES_KEY);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreenActive(Boolean(document.fullscreenElement));
    };

    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!API_BASE_URL) {
      setServerStatus('Server URL is missing.');
      return;
    }

    fetch(`${API_BASE_URL}/api/health`)
      .then((response) => response.json())
      .then((data) => {
        setServerStatus(data?.message || 'Server connected.');
      })
      .catch(() => {
        setServerStatus('Server is offline. Local PDF viewing still works.');
      });
  }, []);

  useEffect(() => {
    const { body, documentElement } = document;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverflow = documentElement.style.overflow;

    if (viewerOpen) {
      body.style.overflow = 'hidden';
      documentElement.style.overflow = 'hidden';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [viewerOpen]);

  useEffect(() => {
    const updateActiveSection = () => {
      const viewportMiddle = window.innerHeight / 2;
      let nextActiveSectionId = TRACKED_SECTIONS[0];
      let closestDistance = Number.POSITIVE_INFINITY;

      TRACKED_SECTIONS.forEach((sectionId) => {
        const sectionElement = sectionRefs.current[sectionId];
        if (!sectionElement) {
          return;
        }

        const rect = sectionElement.getBoundingClientRect();
        const sectionMiddle = rect.top + rect.height / 2;
        const distanceFromViewportMiddle = Math.abs(sectionMiddle - viewportMiddle);

        if (distanceFromViewportMiddle < closestDistance) {
          closestDistance = distanceFromViewportMiddle;
          nextActiveSectionId = sectionId;
        }
      });

      setActiveSectionId(nextActiveSectionId);
    };

    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);

    return () => {
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    };
  }, []);

  const setSectionRef = (sectionId) => (element) => {
    sectionRefs.current[sectionId] = element;
  };

  const toggleLearnMode = () => {
    if (!activeSectionId) {
      return;
    }

    setHiddenSections((current) => ({
      ...current,
      [activeSectionId]: !current[activeSectionId]
    }));
  };

  const renderSectionOverlay = (sectionId) => {
    if (!hiddenSections[sectionId]) {
      return null;
    }

    return (
      <div className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] bg-black/95" />
    );
  };

  const openFileInViewer = (file) => {
    if (!file) {
      return;
    }

    const showNextFile = () => {
      setSelectedFile(file);
      setViewerOpen(true);
    };

    if (viewerOpen) {
      setViewerOpen(false);
      setSelectedFile(null);
      window.setTimeout(showNextFile, 0);
    } else {
      showNextFile();
    }

    setRecentFiles((current) => {
      const nextRecentFiles = [
        {
          name: file.name,
          size: file.size,
          lastOpenedAt: new Date().toISOString()
        },
        ...current.filter((entry) => entry.name !== file.name)
      ].slice(0, 6);

      window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(nextRecentFiles));
      return nextRecentFiles;
    });

    const rootElement = document.documentElement;
    if (rootElement.requestFullscreen) {
      rootElement.requestFullscreen().catch(() => {
        // Some browsers still block fullscreen requests. The viewer overlay still opens.
      });
    }
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    openFileInViewer(file);
    event.target.value = '';
  };

  const handleChoosePdf = async () => {
    if ('showOpenFilePicker' in window) {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'PDF files',
              accept: {
                'application/pdf': ['.pdf']
              }
            }
          ]
        });
        const file = await fileHandle.getFile();
        openFileInViewer(file);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
      }
    }

    fileInputRef.current?.click();
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragActive(false);
    const file = Array.from(event.dataTransfer.files || []).find(
      (candidate) => candidate.type === 'application/pdf' || candidate.name?.toLowerCase().endsWith('.pdf')
    );
    openFileInViewer(file);
  };

  const enterFullscreen = () => {
    const rootElement = document.documentElement;
    if (rootElement.requestFullscreen) {
      rootElement.requestFullscreen().catch(() => {
        // Browser may block the request. Viewer remains open in normal mode.
      });
    }
  };

  const closeViewer = () => {
    setViewerOpen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <motion.header
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-300">
              PDF Viewer
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm text-slate-300 sm:gap-6">
            <a href="#what-we-are" className="transition hover:text-white">
              What We Are
            </a>
            <a href="#services" className="transition hover:text-white">
              Services
            </a>
            <a href="#features" className="transition hover:text-white">
              Features
            </a>
            <button
              type="button"
              className="rounded-xl border border-cyan-300/30 bg-slate-900/85 px-4 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-300/50 hover:bg-slate-900"
              onClick={toggleLearnMode}
            >
              Learn
            </button>
          </nav>
        </motion.header>

        <input
          id="pdf-upload"
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept="application/pdf"
          onChange={handleFileChange}
        />

        <motion.section
          id="quick-open"
          ref={setSectionRef('quick-open')}
          className="relative mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.08 }}
        >
          <div
            className={`rounded-3xl border p-6 transition duration-200 sm:p-8 ${
              isDragActive
                ? 'border-cyan-300/60 bg-cyan-400/10'
                : 'border-white/10 bg-white/5'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) {
                return;
              }
              setIsDragActive(false);
            }}
            onDrop={handleDrop}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Quick Open
            </p>
            <h2 className="mt-4 text-3xl font-semibold text-white">
              Open a PDF the way a real desktop reader should
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Click to choose a file from your PC or drag a PDF into this area. As soon as you
              open it, the app launches your viewer and requests full-screen mode automatically.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <motion.button
                type="button"
                className="rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleChoosePdf}
              >
                Select PDF from PC
              </motion.button>
              <div className="rounded-2xl border border-dashed border-white/15 px-5 py-3 text-sm text-slate-400">
                Drag and drop `.pdf` here
                <div className="mt-1 text-xs text-slate-500">{serverStatus}</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                  Recent Files
                </p>
                <h2 className="mt-3 text-2xl font-semibold text-white">Recently opened PDFs</h2>
              </div>
              {recentFiles.length ? (
                <button
                  type="button"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                  onClick={() => {
                    setRecentFiles([]);
                    window.localStorage.removeItem(RECENT_FILES_KEY);
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="mt-5 space-y-3">
              {recentFiles.length ? (
                recentFiles.map((entry) => (
                  <motion.div
                    key={`${entry.name}-${entry.lastOpenedAt}`}
                    className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"
                    whileHover={{ y: -2 }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{entry.name}</p>
                        <p className="mt-1 text-xs text-slate-400">{formatOpenedAt(entry.lastOpenedAt)}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-300">
                        {formatFileSize(entry.size)}
                      </span>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-4 text-sm text-slate-400">
                  No PDFs opened yet. Choose one from your PC and it will appear here.
                </div>
              )}
            </div>
          </div>
          {renderSectionOverlay('quick-open')}
        </motion.section>

        <motion.section
          id="what-we-are"
          ref={setSectionRef('what-we-are')}
          className="relative mt-10 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
            What We Are
          </p>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <h2 className="text-3xl font-semibold text-white">
              We are building a focused PDF viewer for smooth reading across pages
            </h2>
            <p className="text-sm leading-7 text-slate-300 sm:text-base">
              This viewer is designed for people who read long PDFs and want navigation that feels
              natural. Instead of losing your position every time you change pages, the viewer
              remembers the section you left and brings you back there when you return.
            </p>
          </div>
          {renderSectionOverlay('what-we-are')}
        </motion.section>

        <motion.section
          id="services"
          ref={setSectionRef('services')}
          className="relative mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.14 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Services
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              ['PDF opening', 'Load local PDF files instantly into a dedicated reading screen.'],
              ['Full-screen reading', 'Start reading in a full-screen viewer built for focus.'],
              ['Navigation memory', 'Move between pages and return to the same reading section.']
            ].map(([title, text]) => (
              <motion.article
                key={title}
                className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"
                whileHover={{ y: -4 }}
              >
                <h3 className="text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
              </motion.article>
            ))}
          </div>
          {renderSectionOverlay('services')}
        </motion.section>

        <motion.section
          id="features"
          ref={setSectionRef('features')}
          className="relative mt-6 rounded-3xl border border-white/10 bg-white/5 p-6 sm:p-8"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18 }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
            Features
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              'Open PDF files',
              'Full-screen by default',
              'Remember previous page section',
              'Zoom and fit width',
              'Rotate pages',
              'Desktop and mobile layout',
              'Arrow key navigation',
              'Simple clean interface'
            ].map((feature) => (
              <motion.div
                key={feature}
                className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm font-medium text-slate-200"
                whileHover={{ y: -3, scale: 1.01 }}
              >
                {feature}
              </motion.div>
            ))}
          </div>
          {renderSectionOverlay('features')}
        </motion.section>
      </section>

      <AnimatePresence>
        {viewerOpen && selectedFile ? (
          <PdfViewer
            key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}
            file={selectedFile}
            onClose={closeViewer}
            isFullscreenActive={isFullscreenActive}
            onEnterFullscreen={enterFullscreen}
          />
        ) : null}
      </AnimatePresence>
      <Analytics />
    </main>
  );
}
