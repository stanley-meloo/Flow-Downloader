import { useState, useRef, useEffect } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { downloadDir } from "@tauri-apps/api/path";

export default function useDownloader(settings, showToast) {
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [queue, setQueue] = useState([]);
  const [mediaData, setMediaData] = useState(null);
  const [downloadPath, setDownloadPath] = useState("");

  const activeProcesses = useRef({});
  const manuallyHandled = useRef(new Set());
  const lastUpdate = useRef({});

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // --- 1. COMPLETE ANALYSIS ---
  async function analyzeLink() {
    if (!url) return;
    setAnalyzing(true);
    try {
      const playlistLimit = settings.playlistLimit ? String(settings.playlistLimit) : '25';

      const args = [
        '--dump-single-json',
        '--flat-playlist',
        '--yes-playlist',
        '--ignore-errors',
        '--no-warnings',
        '--playlist-items', `1-${playlistLimit}`,
        url
      ];

      const cmd = Command.sidecar('ytdlp', args);
      const output = await cmd.execute();
      const data = JSON.parse(output.stdout);

      const isPlaylist = data._type === 'playlist' && Array.isArray(data.entries);

      if (isPlaylist) {
        let validEntries = data.entries.filter(entry =>
          entry !== null &&
          entry !== undefined &&
          entry.id &&
          entry.title &&
          !entry.title.includes('[Private video]') &&
          !entry.title.includes('[Deleted video]')
        );

        const limit = parseInt(playlistLimit, 10);
        if (validEntries.length > limit) {
          validEntries = validEntries.slice(0, limit);
        }

        validEntries = validEntries.map((entry, idx) => ({
          ...entry,
          uniqueId: `${entry.id}-${idx}`
        }));

        let dynamicQualities = [1080, 720, 480, 360];
        let has60fps = false;

        if (validEntries.length > 0) {
          try {
            const firstVideoUrl = validEntries[0].url || `https://www.youtube.com/watch?v=${validEntries[0].id}`;
            const firstVideoCmd = Command.sidecar('ytdlp', [
              '--dump-single-json',
              '--no-playlist',
              '--ignore-errors',
              '--no-warnings',
              firstVideoUrl
            ]);
            
            const firstOutput = await firstVideoCmd.execute();
            const firstData = JSON.parse(firstOutput.stdout);

            let maxRes = 1080;
            if (firstData.formats && Array.isArray(firstData.formats)) {
              const videoFormats = firstData.formats.filter(f => f.height);
              if (videoFormats.length > 0) {
                maxRes = Math.max(...videoFormats.map(f => f.height));
              }
              has60fps = videoFormats.some(f => f.fps && f.fps > 30);
            }

            const allQualities = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
            const filteredQualities = allQualities.filter(q => q <= maxRes);
            if (filteredQualities.length > 0) dynamicQualities = filteredQualities;

          } catch (firstErr) {
            console.warn("Não foi possível analisar o primeiro vídeo para base de qualidade. Usando padrão.", firstErr);
          }
        }

        setMediaData({
          id: data.id,
          title: `[Playlist] ${data.title}`,
          thumbnail: data.thumbnails ? data.thumbnails[0]?.url : (validEntries[0]?.thumbnails?.[0]?.url || null),
          isPlaylist: true,
          entries: validEntries,
          count: validEntries.length,
          originalUrl: url,
          uploader: data.uploader || data.channel || data.extractor_key,
          extractor_key: data.extractor_key,
          // Agora passamos a qualidade baseada no primeiro vídeo!
          availableQualities: dynamicQualities,
          availableFps: has60fps ? [60, 30] : [30],
          availableAudio: [320, 256, 192, 128]
        });

      } else {
        let maxRes = 1080; 
        let has60fps = false;

        if (data.formats && Array.isArray(data.formats)) {
           const videoFormats = data.formats.filter(f => f.height);
           
           if (videoFormats.length > 0) {
             maxRes = Math.max(...videoFormats.map(f => f.height));
           }

           has60fps = videoFormats.some(f => f.fps && f.fps > 30);
        }

        const allQualities = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
        const dynamicQualities = allQualities.filter(q => q <= maxRes);

        setMediaData({
          id: data.id,
          title: data.title,
          thumbnail: data.thumbnail,
          isPlaylist: false,
          originalUrl: url,
          uploader: data.uploader || data.channel,
          duration: data.duration,
          extractor_key: data.extractor_key,
          availableQualities: dynamicQualities.length > 0 ? dynamicQualities : [1080, 720, 480, 360],
          availableFps: has60fps ? [60, 30] : [30],
          availableAudio: [320, 256, 192, 128]
        });
      }

      if (!downloadPath) {
        setDownloadPath(settings.defaultPath || await downloadDir());
      }
    } catch (err) {
      console.error(err);
      showToast("error_invalid", "error");
    } finally {
      setAnalyzing(false);
    }
  }

  // --- 2. START WITH CONFIGURATIONS ---
  function startDownload(config, formatType, customData) {
    const dataToDownload = customData || mediaData;
    if (!dataToDownload) return;

    const newItems = [];

    const safeRes = config?.res ? config.res.replace('p', '') : 'best';
    const safeFps = config?.fps ? config.fps.replace(' FPS', '') : 'Original';
    const safeAudio = config?.audio ? config.audio.replace('kb', '') : '320';
    const safeExt = config?.ext ? config.ext.replace('.', '') : 'mp4';

    const downloadSettings = {
      targetRes: safeRes,
      targetFps: safeFps,
      targetAudio: safeAudio,
      ext: safeExt,
      formatType: formatType || 'video'
    };

    if (dataToDownload.isPlaylist && dataToDownload.entries) {
      dataToDownload.entries.forEach(entry => {
        if (!entry || !entry.title) return;

        const thumbUrl = entry.thumbnails?.[0]?.url || (entry.id ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` : null);

        newItems.push({
          id: crypto.randomUUID(),
          title: entry.title,
          thumbnail: thumbUrl,
          status: "Aguardando",
          progress: 0,
          speed: "0 KB/s",
          eta: "--:--",
          totalTime: null,
          url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
          directory: downloadPath,
          ...downloadSettings
        });
      });
    } else {
      newItems.push({
        id: crypto.randomUUID(),
        title: dataToDownload.title,
        thumbnail: dataToDownload.thumbnail,
        status: "Aguardando",
        progress: 0,
        speed: "0 KB/s",
        eta: "--:--",
        totalTime: null,
        url: dataToDownload.originalUrl,
        directory: downloadPath,
        ...downloadSettings
      });
    }

    setQueue(prev => [...prev, ...newItems]);
    setMediaData(null);
    setUrl("");
    
    showToast("success_added", "success");
  }

  // --- 3. DYNAMIC PROCESSOR ---
  useEffect(() => {
    const processQueue = () => {
      const MAX_CONCURRENT_DOWNLOADS = 3;
      const activeCount = Object.keys(activeProcesses.current).length;

      if (activeCount >= MAX_CONCURRENT_DOWNLOADS) return;

      const waitingItems = queue.filter(item =>
        item.status === "Aguardando" && !activeProcesses.current[item.id]
      );

      if (waitingItems.length === 0) return;

      const slotsAvailable = MAX_CONCURRENT_DOWNLOADS - activeCount;
      const itemsToStart = waitingItems.slice(0, slotsAvailable);

      itemsToStart.forEach(async (nextItem) => {
        const itemId = nextItem.id;
        const startTime = Date.now();

        if (manuallyHandled.current.has(itemId)) manuallyHandled.current.delete(itemId);

        activeProcesses.current[itemId] = "starting";
        lastUpdate.current[itemId] = 0;

        try {
          updateItemStatus(itemId, "Baixando");

          const safeTitle = nextItem.title.replace(/[\\/:*?"<>|]/g, "").replace(/ /g, "_");

          let formatString = 'best';
          let additionalArgs = [];
          const finalExt = nextItem.ext || 'mp4';

          let resFilter = '';
          if (nextItem.targetRes && nextItem.targetRes !== 'best' && nextItem.targetRes !== 'Original') {
            resFilter = `[height<=${nextItem.targetRes}]`;
          }

          if (nextItem.formatType === 'audio') {
            formatString = 'bestaudio/best';
            const safeAudioExt = finalExt === 'mp4' ? 'm4a' : finalExt;
            additionalArgs = [
              '--extract-audio',
              '--audio-format', safeAudioExt,
              '--audio-quality', `${nextItem.targetAudio}K`
            ];
          } else if (nextItem.formatType === 'video_only') {
            // Forces video to download at H.264 if available for better editing compatibility, otherwise falls back to best video stream of any codec
            formatString = `bestvideo${resFilter}[vcodec^=avc1]/bestvideo${resFilter}/best`;
            additionalArgs = ['--remux-video', finalExt];
          } else {
            if (finalExt === 'mp4') {
              formatString = `bestvideo${resFilter}[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo${resFilter}+bestaudio/best${resFilter}/best`;
            } else {
              // To MKV or other formats, we can allow any audio codec since it will be remuxed, which increases the chances of getting the best quality audio available
              formatString = `bestvideo${resFilter}[vcodec^=avc1]+bestaudio/bestvideo${resFilter}+bestaudio/best${resFilter}/best`;
            }
            additionalArgs = ['--merge-output-format', finalExt];
          }

          if (nextItem.targetFps !== 'Original' && nextItem.formatType !== 'audio') {
            additionalArgs.push('--postprocessor-args', `video:-r ${nextItem.targetFps}`);
          }

          const args = [
            '-f', formatString,
            ...additionalArgs,
            '-o', `${nextItem.directory}/${safeTitle}.%(ext)s`,
            '--no-playlist',
            '--no-warnings',
            '--ignore-errors',
            '--compat-options', 'no-youtube-unavailable-videos',
            nextItem.url
          ];

          const cmd = Command.sidecar('ytdlp', args);

          cmd.on('close', (data) => {
            if (manuallyHandled.current.has(itemId)) {
              delete activeProcesses.current[itemId];
              manuallyHandled.current.delete(itemId);
              return;
            }

            delete activeProcesses.current[itemId];

            setQueue(prev => {
              const item = prev.find(i => i.id === itemId);
              if (!item) return prev;

              if (data.code === 0 || item.progress >= 99) {
                const timeTaken = formatDuration(Date.now() - startTime);
                return prev.map(i => i.id === itemId ? { ...i, status: "Concluído", progress: 100, totalTime: timeTaken } : i);
              } else {
                return prev.map(i => i.id === itemId ? { ...i, status: "Erro" } : i);
              }
            });
          });

          cmd.on('error', (err) => {
            if (manuallyHandled.current.has(itemId)) return;
            console.warn(`Aviso não-fatal no processo ${itemId}:`, err);
          });

          cmd.stdout.on('data', (line) => {
            if (manuallyHandled.current.has(itemId)) return;
            const text = line.toString();

            if (text.includes('[download]')) {
              const now = Date.now();
              if (now - (lastUpdate.current[itemId] || 0) < 150) return;
              lastUpdate.current[itemId] = now;

              const progressMatch = text.match(/(\d+\.?\d*)%/);
              const speedMatch = text.match(/at\s+([^\s]+)/);
              const etaMatch = text.match(/ETA\s+([^\s]+)/);

              const parsedProgress = progressMatch ? parseFloat(progressMatch[1]) : null;

              setQueue(prev => prev.map(item => {
                if (item.id === itemId) {
                  const newProgress = parsedProgress !== null ? Math.max(item.progress, parsedProgress) : item.progress;
                  const currentStatus = newProgress >= 100 ? "Processando..." : "Baixando";

                  return {
                    ...item,
                    status: currentStatus,
                    progress: newProgress,
                    speed: speedMatch ? speedMatch[1] : item.speed,
                    eta: etaMatch ? etaMatch[1] : item.eta
                  };
                }
                return item;
              }));
            }
          });

          const child = await cmd.spawn();
          activeProcesses.current[itemId] = child;

        } catch (error) {
          updateItemStatus(itemId, "Erro");
          delete activeProcesses.current[itemId];
        }
      });
    };

    processQueue();
  }, [queue]);

  const updateItemStatus = (id, status, progress = null) => {
    setQueue(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, status, progress: progress !== null ? progress : item.progress };
      }
      return item;
    }));
  };

  const cancelDownload = async (id) => {
    const child = activeProcesses.current[id];
    manuallyHandled.current.add(id);
    if (child && child !== "starting") {
      try { await child.kill(); } catch (e) { }
    }
    delete activeProcesses.current[id];
    updateItemStatus(id, "Cancelado");
  };

  const retryDownload = (id) => {
    updateItemStatus(id, "Aguardando", 0);
  };

  const removeItem = (id) => {
    if (activeProcesses.current[id]) cancelDownload(id);
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  return {
    url, setUrl,
    analyzing, analyzeLink,
    queue,
    mediaData, setMediaData,
    startDownload,
    downloadPath, setDownloadPath,
    cancelDownload,
    retryDownload,
    removeItem
  };
}