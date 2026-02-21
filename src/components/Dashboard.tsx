import { useEffect, useState, useRef } from 'react';
import { getSnapshotUrl, rpc, rpcJson, BASE_URL } from '../lib/client';
import { 
  RefreshCw, Play, Pause, X, Monitor, Settings, 
  RotateCcw, Plus, LogOut, Layout, Maximize2, 
  ChevronRight, ChevronLeft, Trash2, ExternalLink,
  Search, Sliders, Check, AlertCircle, Terminal, Wifi
} from 'lucide-react';

interface WindowInfo {
  id: number;
  title: string;
  url: string;
  bounds: { x: number; y: number; width: number; height: number };
}

interface DashboardProps {
  onLogout: () => void;
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [selectedWinId, setSelectedWinId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Capture settings
  const [interval, setIntervalMs] = useState(1000);
  const [quality, setQuality] = useState(80);
  const [scale, setScale] = useState(0.5);

  // Bounds inputs
  const [bounds, setBounds] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [applyingBounds, setApplyingBounds] = useState(false);
  const [boundsFeedback, setBoundsFeedback] = useState<{ msg: string; error: boolean } | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [pingTime, setPingTime] = useState<number | null>(null);

  // Keyboard input handler
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!selectedWinId || e.ctrlKey || e.altKey || e.metaKey) return;
      
      const key = e.key;
      if (key.length !== 1 && !['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) {
        return;
      }

      try {
        const codeMap: Record<string, string> = {
          'Enter': 'Return', 'Backspace': 'Backspace', 'Tab': 'Tab', 'Escape': 'Escape',
          'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
          'Delete': 'Delete', 'Insert': 'Insert', 'Home': 'Home', 'End': 'End',
          'PageUp': 'PageUp', 'PageDown': 'PageDown'
        };
        
        const keyCode = codeMap[key] || (key.length === 1 ? key.toUpperCase() : key);
        
        await rpc('control_electron_WebContents', {
          win_id: selectedWinId,
          code: `webContents.sendInputEvent({type: 'keyDown', keyCode: '${keyCode}', key: '${key}'})`
        });
        
        if (key === 'Enter' || key === 'Tab' || key === 'Backspace') {
          await rpc('control_electron_WebContents', {
            win_id: selectedWinId,
            code: `webContents.sendInputEvent({type: 'keyUp', keyCode: '${keyCode}', key: '${key}'})`
          });
        }
      } catch (err) {
        console.error('Key send failed:', err);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWinId]);

  // Ping to measure network latency
  useEffect(() => {
    const ping = async () => {
      const start = Date.now();
      try {
        await fetch(BASE_URL.replace('/rpc', '') + '/ui/snapshot?win_id=0&token=x', { 
          method: 'HEAD',
          cache: 'no-store' 
        });
        setPingTime(Date.now() - start);
      } catch {
        setPingTime(null);
      }
    };
    ping();
    const interval = setInterval(ping, 5000);
    return () => clearInterval(interval);
  }, []);

  // Load windows on mount
  useEffect(() => {
    loadWindows();
    const savedWin = localStorage.getItem('ELECTRON_MCP_SELECTED_WIN');
    if (savedWin) setSelectedWinId(parseInt(savedWin));
    
    const savedInterval = localStorage.getItem('ELECTRON_MCP_INTERVAL');
    if (savedInterval) setIntervalMs(parseInt(savedInterval));

    const savedQuality = localStorage.getItem('ELECTRON_MCP_QUALITY');
    if (savedQuality) setQuality(parseInt(savedQuality));

    const savedScale = localStorage.getItem('ELECTRON_MCP_SCALE');
    if (savedScale) setScale(parseFloat(savedScale));

    const savedLoop = localStorage.getItem('ELECTRON_MCP_LOOP');
    if (savedLoop) setLoopEnabled(savedLoop !== 'false');

    const savedControls = localStorage.getItem('CONTROLS_VISIBLE');
    if (savedControls) setControlsOpen(savedControls !== 'false');
  }, []);

  // Update bounds state when selected window changes
  useEffect(() => {
    if (selectedWinId) {
      const win = windows.find(w => w.id === selectedWinId);
      if (win) {
        setBounds({
          x: win.bounds.x,
          y: win.bounds.y,
          w: win.bounds.width,
          h: win.bounds.height
        });
        // Focus window
        rpc('control_electron_BrowserWindow', { win_id: selectedWinId, code: 'win.focus()' }).catch(() => {});
      }
      localStorage.setItem('ELECTRON_MCP_SELECTED_WIN', selectedWinId.toString());
    }
  }, [selectedWinId, windows]);

  // Capture loop
  useEffect(() => {
    if (!selectedWinId || !loopEnabled) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const tick = async () => {
      if (!imgRef.current || !selectedWinId) return;
      try {
        const url = getSnapshotUrl(selectedWinId, quality, scale);
        const res = await fetch(url);
        if (!res.ok) return;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        
        const oldUrl = imgRef.current.getAttribute('data-object-url');
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        
        imgRef.current.src = objectUrl;
        imgRef.current.setAttribute('data-object-url', objectUrl);
      } catch (e) {
        console.error("Capture error", e);
      }
    };

    tick();
    timerRef.current = setInterval(tick, interval);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [selectedWinId, loopEnabled, interval, quality, scale]);

  const loadWindows = async () => {
    setLoading(true);
    try {
      const data = await rpcJson<WindowInfo[]>('get_windows');
      setWindows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenWindow = async (url: string, accountIdx: number = 0) => {
    try {
      const wins = await rpcJson<WindowInfo[]>('get_windows');
      const allWindows = Array.isArray(wins) ? wins : [];
      const existing = allWindows.find(w => w.url && w.url.includes(new URL(url).hostname));
      
      if (existing) {
        await rpc('control_electron_BrowserWindow', { win_id: existing.id, code: 'win.focus()' });
        setSelectedWinId(existing.id);
      } else {
        await rpc('open_window', { 
          url, 
          accountIdx,
          reuseWindow: false,
          options: { width: 1200, height: 800 }
        });
        loadWindows();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCloseAll = async () => {
    if (!confirm('Close all windows?')) return;
    try {
      const wins = await rpcJson<WindowInfo[]>('get_windows');
      await Promise.all((Array.isArray(wins) ? wins : []).map(w => rpc('close_window', { win_id: w.id })));
      setSelectedWinId(null);
      loadWindows();
    } catch (e) {
      console.error(e);
    }
  };

  const handleApplyBounds = async () => {
    if (!selectedWinId) return;
    setApplyingBounds(true);
    setBoundsFeedback(null);
    try {
      const res = await rpc('set_window_bounds', {
        win_id: selectedWinId,
        x: bounds.x,
        y: bounds.y,
        width: bounds.w,
        height: bounds.h
      });
      const data = await res.json();
      const isErr = data.result?.isError;
      const msg = isErr ? (data.result?.content?.[0]?.text || 'Error') : 'Applied successfully';
      setBoundsFeedback({ msg, error: !!isErr });
      loadWindows();
    } catch (e: any) {
      setBoundsFeedback({ msg: e.message, error: true });
    } finally {
      setApplyingBounds(false);
    }
  };

  const handleReloadPage = async () => {
    if (!selectedWinId) return;
    await rpc('control_electron_BrowserWindow', { win_id: selectedWinId, code: 'win.reload()' });
  };

  const handleCloseWindow = async () => {
    if (!selectedWinId) return;
    if (!confirm(`Close window #${selectedWinId}?`)) return;
    await rpc('close_window', { win_id: selectedWinId });
    setSelectedWinId(null);
    loadWindows();
  };

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!selectedWinId || !imgRef.current) return;

    const rect = imgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate relative coordinates (0.0 to 1.0)
    const rx = x / rect.width;
    const ry = y / rect.height;

    // Get window bounds to calculate absolute coordinates
    const win = windows.find(w => w.id === selectedWinId);
    if (!win) return;

    // Calculate absolute coordinates in the window
    const absoluteX = Math.round(rx * win.bounds.width);
    const absoluteY = Math.round(ry * win.bounds.height);

    console.log(`Click: ${absoluteX}, ${absoluteY} (Window: ${win.bounds.width}x${win.bounds.height})`);

    try {
      await rpc('cdp_click', {
        win_id: selectedWinId,
        x: absoluteX,
        y: absoluteY,
        button: 'left'
      });
    } catch (err) {
      console.error('Click failed:', err);
    }
  };

  const selectedWindow = windows.find(w => w.id === selectedWinId);

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans selection:bg-indigo-500/30">
      
      {/* Left Sidebar - Window List */}
      <aside className={`${sidebarOpen ? 'w-72' : 'w-0'} bg-zinc-900 border-r border-zinc-800 flex flex-col transition-all duration-300 overflow-hidden shrink-0`}>
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between shrink-0 h-16">
          <h2 className="font-semibold text-sm tracking-tight flex items-center gap-2.5 text-zinc-100">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Layout className="w-4 h-4 text-indigo-500" />
            </div>
            Windows
          </h2>
          <button 
            onClick={loadWindows} 
            disabled={loading}
            className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {windows.length === 0 && !loading && (
             <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-3">
               <Monitor className="w-8 h-8 opacity-20" />
               <span className="text-xs">No active windows</span>
             </div>
          )}
          
          {windows.map(w => (
            <button
              key={w.id}
              onClick={() => {
                setSelectedWinId(w.id);
                localStorage.setItem('ELECTRON_MCP_SELECTED_WIN', w.id.toString());
                // Force immediate refresh
                if (imgRef.current && loopEnabled) {
                  getSnapshotUrl(w.id, quality, scale).then(url => {
                    fetch(url).then(res => res.blob()).then(blob => {
                      const objectUrl = URL.createObjectURL(blob);
                      const oldUrl = imgRef.current?.getAttribute('data-object-url');
                      if (oldUrl) URL.revokeObjectURL(oldUrl);
                      if (imgRef.current) {
                        imgRef.current.src = objectUrl;
                        imgRef.current.setAttribute('data-object-url', objectUrl);
                      }
                    });
                  });
                }
              }}
              className={`w-full text-left px-3 py-3 rounded-xl text-sm transition-all group relative border ${
                selectedWinId === w.id 
                  ? 'bg-zinc-800 border-zinc-700 text-white shadow-sm' 
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 border-transparent hover:border-zinc-800'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium truncate pr-2">{w.title || 'Untitled Window'}</div>
                {selectedWinId === w.id && (
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)] shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono mt-1">
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">#{w.id}</span>
                <span>{w.bounds.width}×{w.bounds.height}</span>
                <span className="text-zinc-600">@</span>
                <span>{w.bounds.x},{w.bounds.y}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 space-y-3 shrink-0">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider px-1">Quick Launch</div>
          <div className="grid grid-cols-2 gap-2">
             <button onClick={() => handleOpenWindow('https://chatgpt.com')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium transition-colors">
               <ExternalLink className="w-3 h-3 text-emerald-500" /> ChatGPT
             </button>
             <button onClick={() => handleOpenWindow('https://gemini.google.com')} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium transition-colors">
               <ExternalLink className="w-3 h-3 text-blue-500" /> Gemini
             </button>
             <button onClick={() => handleOpenWindow('https://aistudio.google.com')} className="col-span-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-medium transition-colors">
               <ExternalLink className="w-3 h-3 text-purple-500" /> AI Studio
             </button>
          </div>
          <div className="pt-2 border-t border-zinc-800">
            <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors text-xs font-medium">
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
          <div className="pt-2 border-t border-zinc-800 text-center">
            <span className="text-[10px] text-zinc-600 font-mono">v1.0.0</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-zinc-950 relative">
        {/* Header Toolbar */}
        <header className="h-16 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between px-6 shrink-0 backdrop-blur-sm z-10">
           <div className="flex items-center gap-4">
             <button 
               onClick={() => setSidebarOpen(!sidebarOpen)}
               className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
             >
               {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
             </button>
             
             <div className="h-6 w-px bg-zinc-800" />

             {selectedWindow ? (
               <div>
                 <h1 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                   {selectedWindow.title || 'Untitled Window'}
                   <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                     #{selectedWindow.id}
                   </span>
                 </h1>
                 <div className="text-xs text-zinc-500 truncate max-w-md">{selectedWindow.url}</div>
               </div>
             ) : (
               <div className="text-sm text-zinc-500">No window selected</div>
             )}
           </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50 text-xs">
                <Wifi className={`w-3.5 h-3.5 ${pingTime ? 'text-emerald-400' : 'text-red-400'}`} />
                <span className={`font-mono ${pingTime ? 'text-zinc-300' : 'text-red-400'}`}>
                  {pingTime ? `${pingTime}ms` : '--'}
                </span>
              </div>

              <button 
                 onClick={() => {
                   const newVal = !loopEnabled;
                   setLoopEnabled(newVal);
                   localStorage.setItem('ELECTRON_MCP_LOOP', String(newVal));
                 }}
                 className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                   loopEnabled 
                     ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20' 
                     : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                 }`}
               >
                 {loopEnabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                 {loopEnabled ? 'Live' : 'Paused'}
               </button>

              <button
                onClick={() => {
                  const newVal = !controlsOpen;
                  setControlsOpen(newVal);
                  localStorage.setItem('CONTROLS_VISIBLE', String(newVal));
                }}
                className={`p-2 rounded-lg transition-colors border ${
                  controlsOpen 
                    ? 'bg-zinc-800 text-zinc-100 border-zinc-700' 
                    : 'text-zinc-400 border-transparent hover:bg-zinc-800'
                }`}
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>
        </header>

        {/* Canvas */}
        <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-zinc-950">
           {/* Grid Pattern Background */}
           <div className="absolute inset-0 opacity-[0.03]" style={{ 
             backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', 
             backgroundSize: '24px 24px' 
           }} />
           
            {selectedWinId ? (
             <div className="relative z-0 max-w-full max-h-full p-8 flex items-center justify-center">
                <img 
                  ref={imgRef} 
                  onClick={handleImageClick}
                  onDragStart={(e) => e.preventDefault()}
                  draggable={false}
                  alt="Live capture" 
                  className="max-w-full max-h-full object-contain shadow-2xl shadow-black rounded-lg ring-1 ring-zinc-800 bg-zinc-900 cursor-crosshair select-none" 
                />
             </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-zinc-600 relative z-0">
              <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <Monitor className="w-8 h-8 opacity-50" />
              </div>
              <p className="text-sm font-medium">Select a window to start monitoring</p>
            </div>
          )}
        </div>
      </main>

      {/* Right Sidebar - Controls */}
      <aside className={`${controlsOpen ? 'w-80' : 'w-0'} bg-zinc-900 border-l border-zinc-800 flex flex-col transition-all duration-300 overflow-hidden shrink-0`}>
         <div className="p-4 border-b border-zinc-800 h-16 flex items-center shrink-0">
           <h2 className="font-semibold text-sm tracking-tight flex items-center gap-2 text-zinc-100">
             <Settings className="w-4 h-4 text-zinc-400" />
             Controls
           </h2>
         </div>

         {selectedWinId ? (
           <div className="flex-1 overflow-y-auto p-5 space-y-8">
             
             {/* Capture Settings */}
             <div className="space-y-4">
               <div className="flex items-center justify-between">
                 <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Capture Settings</h3>
               </div>
               
               <div className="space-y-4">
                 <div className="space-y-2">
                   <div className="flex justify-between text-xs">
                     <span className="text-zinc-400">Interval</span>
                     <span className="text-zinc-200 font-mono">{(interval / 1000).toFixed(1)}s</span>
                   </div>
                   <input 
                      type="range" min="200" max="5000" step="100" 
                      value={interval} 
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setIntervalMs(v);
                        localStorage.setItem('ELECTRON_MCP_INTERVAL', String(v));
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                 </div>

                 <div className="space-y-2">
                   <div className="flex justify-between text-xs">
                     <span className="text-zinc-400">Quality</span>
                     <span className="text-zinc-200 font-mono">{quality}%</span>
                   </div>
                   <input 
                      type="range" min="10" max="100" step="5" 
                      value={quality} 
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setQuality(v);
                        localStorage.setItem('ELECTRON_MCP_QUALITY', String(v));
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                 </div>

                 <div className="space-y-2">
                   <div className="flex justify-between text-xs">
                     <span className="text-zinc-400">Scale</span>
                     <span className="text-zinc-200 font-mono">{Math.round(scale * 100)}%</span>
                   </div>
                   <input 
                      type="range" min="0.1" max="1" step="0.1" 
                      value={scale} 
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setScale(v);
                        localStorage.setItem('ELECTRON_MCP_SCALE', String(v));
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                 </div>
               </div>
             </div>

             <div className="h-px bg-zinc-800" />

             {/* Bounds */}
             <div className="space-y-4">
               <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Window Bounds</h3>
               <div className="grid grid-cols-2 gap-3">
                  {['x', 'y', 'w', 'h'].map((key) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-[10px] font-medium text-zinc-500 uppercase">{key === 'w' ? 'Width' : key === 'h' ? 'Height' : key}</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          value={bounds[key as keyof typeof bounds]} 
                          onChange={(e) => setBounds({...bounds, [key]: parseInt(e.target.value) || 0})}
                          className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-mono focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" 
                        />
                      </div>
                    </div>
                  ))}
               </div>
               
               <button 
                  onClick={handleApplyBounds}
                  disabled={applyingBounds}
                  className="w-full py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition-all flex items-center justify-center gap-2"
                >
                  {applyingBounds ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {applyingBounds ? 'Applying...' : 'Apply Bounds'}
                </button>
                
                {boundsFeedback && (
                  <div className={`text-xs flex items-center gap-2 p-2 rounded-lg ${boundsFeedback.error ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                    {boundsFeedback.error ? <AlertCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                    {boundsFeedback.msg}
                  </div>
                )}
             </div>

             <div className="h-px bg-zinc-800" />

             {/* Actions */}
             <div className="space-y-3">
               <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Actions</h3>
               <button onClick={handleReloadPage} className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2">
                  <RotateCcw className="w-3.5 h-3.5" /> Reload Page
               </button>
               <button onClick={handleCloseWindow} className="w-full py-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-all flex items-center justify-center gap-2">
                  <X className="w-3.5 h-3.5" /> Close Window
               </button>
             </div>

             <div className="h-px bg-zinc-800" />
             
             <div className="space-y-3">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Danger Zone</h3>
                <button onClick={handleCloseAll} className="w-full py-2.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-all flex items-center justify-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" /> Close All Windows
                </button>
             </div>

           </div>
         ) : (
           <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 p-8 text-center">
             <Settings className="w-10 h-10 opacity-20 mb-3" />
             <p className="text-sm">Select a window to view controls</p>
           </div>
         )}
      </aside>

    </div>
  );
}
