import React, { useState, useEffect, useRef, useCallback } from 'react';

interface PipeItem {
  id: number;
  type: 'text' | 'file';
  text_content: string | null;
  original_name: string | null;
  stored_name: string | null;
  mime_type: string | null;
  size: number | null;
  created_at: number;
}

interface UploadStatus {
  fileName: string;
  progress: number;
  speedMBps: string;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function CreatorCredit() {
  return (
    <p className="text-center text-xs text-zinc-500">
      Made by{' '}
      <a
        href="https://github.com/ordixian"
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400 hover:text-emerald-300 underline underline-offset-4 focus-visible:outline focus-visible:outline-emerald-400"
      >
        Ordixian
      </a>
    </p>
  );
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  const [items, setItems] = useState<PipeItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [retention, setRetention] = useState<'never' | '24h' | '7d'>('never');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchItems = useCallback(async () => {
    const res = await fetch('/api/items');
    if (res.ok) {
      const data = await res.json();
      setItems(data.items);
      setRetention(data.retention);
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((data) => {
        setAuthenticated(Boolean(data.authenticated));
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    fetchItems();

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let active = true;

    const connectWs = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => { setWsConnected(true); fetchItems(); };
      ws.onclose = () => {
        setWsConnected(false);
        if (active) reconnectTimer = setTimeout(connectWs, 1500);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'item_added') {
            setItems((prev) => [msg.item, ...prev.filter((i) => i.id !== msg.item.id)]);
          } else if (msg.type === 'item_deleted') {
            setItems((prev) => prev.filter((i) => i.id !== msg.id));
          } else if (msg.type === 'items_cleared') {
            setItems([]);
          } else if (msg.type === 'retention_updated') {
            setRetention(msg.retention);
            fetchItems();
          }
        } catch {}
      };
    };

    connectWs();
    return () => {
      active = false;
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [authenticated, fetchItems]);

  const sendText = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const res = await fetch('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed })
    });
    if (res.ok) {
      setTextInput('');
    }
  }, []);

  const uploadFile = useCallback((file: File) => {
    return new Promise<void>((resolve) => {
      if (file.size > 1024 * 1024 * 1024) {
        alert(`${file.name} exceeds the 1GB limit.`);
        resolve();
        return;
      }
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      const startTime = Date.now();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          const elapsedSec = Math.max((Date.now() - startTime) / 1000, 0.1);
          const speedMBps = (event.loaded / (1024 * 1024) / elapsedSec).toFixed(1);
          setUploadStatus({
            fileName: file.name,
            progress: percent,
            speedMBps
          });
        }
      };

      xhr.onload = () => {
        setUploadStatus(null);
        if (xhr.status < 200 || xhr.status >= 300) alert(`Upload failed: ${xhr.responseText || xhr.statusText}`);
        resolve();
      };

      xhr.onerror = () => {
        setUploadStatus(null);
        alert('Upload failed or exceeded 1GB limit.');
        resolve();
      };

      xhr.open('POST', '/api/items/file');
      xhr.send(formData);
    });
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    const handleGlobalPaste = async (e: ClipboardEvent) => {
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        e.preventDefault();
        for (const file of Array.from(e.clipboardData.files)) {
          await uploadFile(file);
        }
        return;
      }

      const pastedText = e.clipboardData?.getData('text');
      if (pastedText && pastedText.trim()) {
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'TEXTAREA' || activeTag === 'INPUT') return;
        e.preventDefault();
        await sendText(pastedText);
      }
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [authenticated, sendText, uploadFile]);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    const res = await fetch('/api/auth/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok) {
      setAuthenticated(true);
    } else {
      setPinError(data.error || 'Pairing failed');
    }
  };

  const handlePasteButton = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        await sendText(clipText);
      }
    } catch {
      alert('Tap inside the text box and use your keyboard Paste button.');
    }
  };

  const handleCopy = async (item: PipeItem) => {
    if (!item.text_content) return;
    try {
      await navigator.clipboard.writeText(item.text_content);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = item.text_content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/items/${id}`, { method: 'DELETE' });
  };

  const handleClearAll = async () => {
    if (!confirm('Delete all synced text and files from Pipe?')) return;
    await fetch('/api/items', { method: 'DELETE' });
  };

  const handleRetentionChange = async (val: 'never' | '24h' | '7d') => {
    setRetention(val);
    await fetch('/api/settings/retention', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retention: val })
    });
  };

  if (!authChecked) return null;

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-950">
        <form
          onSubmit={handlePair}
          className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5 shadow-2xl"
        >
          <div className="flex items-center gap-3">
            <img src="/icon.svg" alt="Pipe" className="w-10 h-10 rounded-xl" />
            <div>
              <h1 className="text-xl font-bold text-zinc-100">Connect to Pipe</h1>
              <p className="text-xs text-zinc-400">Enter the 4-digit PIN shown in your terminal</p>
            </div>
          </div>

          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            className="w-full text-center text-3xl tracking-[0.5em] font-mono py-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-emerald-500 focus:outline-none text-emerald-400"
          />

          {pinError && <p className="text-xs text-red-400 text-center">{pinError}</p>}

          <button
            type="submit"
            disabled={pin.length !== 4}
            className="w-full py-3 rounded-xl font-semibold bg-emerald-500 text-zinc-950 hover:bg-emerald-400 disabled:opacity-40 transition"
          >
            Pair Device
          </button>
          <CreatorCredit />
        </form>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          for (const f of Array.from(e.dataTransfer.files)) {
            await uploadFile(f);
          }
        }
      }}
    >
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-emerald-950/80 border-4 border-dashed border-emerald-400 flex items-center justify-center pointer-events-none">
          <p className="text-2xl font-bold text-emerald-300">Drop files anywhere to send</p>
        </div>
      )}

      <header className="sticky top-0 z-20 backdrop-blur-md bg-zinc-950/85 border-b border-zinc-800/80">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="Pipe" className="w-7 h-7 rounded-lg" />
            <span className="font-bold text-lg tracking-tight">Pipe</span>
            <span
              title={wsConnected ? 'Live sync active' : 'Reconnecting...'}
              className={`w-2.5 h-2.5 rounded-full ${
                wsConnected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-500 animate-pulse'
              }`}
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Auto-delete timer"
              value={retention}
              onChange={(e) => handleRetentionChange(e.target.value as 'never' | '24h' | '7d')}
              className="text-xs bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="never">Keep: Forever</option>
              <option value="24h">Auto-delete: 24h</option>
              <option value="7d">Auto-delete: 7d</option>
            </select>

            {items.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-red-950/60 text-zinc-400 hover:text-red-300 border border-zinc-800 transition"
              >
                Clear All
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-4 space-y-5">
        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 space-y-3 shadow-lg">
          <textarea
            rows={3}
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (pasted.trim()) {
                e.preventDefault();
                sendText(pasted);
              }
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                sendText(textInput);
              }
            }}
            placeholder="Type or paste text/links... (Press Ctrl+V anywhere on page for instant send)"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 resize-none"
          />

          {uploadStatus && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-300">
                <span className="truncate max-w-[65%] font-medium">{uploadStatus.fileName}</span>
                <span className="font-mono text-emerald-400">
                  {uploadStatus.progress}% • {uploadStatus.speedMBps} MB/s
                </span>
              </div>
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-150"
                  style={{ width: `${uploadStatus.progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handlePasteButton}
              className="py-2.5 px-3 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition flex items-center justify-center gap-1.5"
            >
              📋 Paste Clipboard
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-3 rounded-xl text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition flex items-center justify-center gap-1.5"
            >
              📁 Send Files
            </button>

            <button
              type="button"
              disabled={!textInput.trim()}
              onClick={() => sendText(textInput)}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-zinc-950 transition"
            >
              Send Text
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
              const files = e.target.files;
              if (!files) return;
              for (const f of Array.from(files)) {
                await uploadFile(f);
              }
              e.target.value = '';
            }}
          />
        </section>

        <section className="space-y-3 pb-10">
          {items.length === 0 ? (
            <div className="text-center py-14 border border-dashed border-zinc-800 rounded-2xl text-zinc-500 text-sm">
              No items yet. Paste text or drop a file to sync instantly.
            </div>
          ) : (
            items.map((item) => {
              const isImage = item.type === 'file' && item.mime_type?.startsWith('image/');
              return (
                <article
                  key={item.id}
                  className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3 shadow"
                >
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className="font-mono uppercase tracking-wider text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                      {item.type === 'text' ? 'TEXT' : formatBytes(item.size)}
                    </span>
                    <div className="flex items-center gap-3">
                      <span>{formatTime(item.created_at)}</span>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="text-zinc-500 hover:text-red-400 transition px-1"
                        title="Delete item"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {item.type === 'text' ? (
                    <>
                      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-zinc-100 bg-zinc-950/70 p-3 rounded-xl border border-zinc-800/80 max-h-80 overflow-y-auto">
                        {item.text_content}
                      </pre>
                      <button
                        onClick={() => handleCopy(item)}
                        className="w-full py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-emerald-400 transition"
                      >
                        {copiedId === item.id ? '✓ Copied to Clipboard' : 'Copy Text'}
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-medium text-zinc-100 break-all">
                        {item.original_name}
                      </div>

                      {isImage && (
                        <div className="rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 flex justify-center">
                          <img
                            src={`/api/files/${item.id}?preview=1`}
                            alt={item.original_name || 'Preview'}
                            loading="lazy"
                            className="max-h-72 object-contain"
                          />
                        </div>
                      )}

                      <a
                        href={`/api/files/${item.id}`}
                        download={item.original_name || 'file'}
                        className="block w-full text-center py-2 rounded-xl text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 transition"
                      >
                        ⬇ Download ({formatBytes(item.size)})
                      </a>
                    </>
                  )}
                </article>
              );
            })
          )}
        </section>
      </main>
      <footer className="px-4 py-5 border-t border-zinc-800">
        <CreatorCredit />
      </footer>
    </div>
  );
}
