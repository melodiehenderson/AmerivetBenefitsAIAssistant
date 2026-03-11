'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';
import { Play, Pause, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const VIDEO_URL = '/videos/welcome.mp4';
const STORAGE_KEY = 'welcome_video_watched';

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function WelcomeVideoModal() {
  const [open, setOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [hasWatched, setHasWatched] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const watched = localStorage.getItem(STORAGE_KEY);
    if (!watched) {
      // Show modal after a short delay to allow page to load
      const timer = setTimeout(() => {
        setOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    } else {
      setHasWatched(true);
    }
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // User closed early - still mark as watched so it doesn't show again
      localStorage.setItem(STORAGE_KEY, 'true');
      videoRef.current?.pause();
    }
    setOpen(newOpen);
  };

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    videoRef.current?.pause();
    setOpen(false);
  };

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const changeSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    const nextSpeed = PLAYBACK_SPEEDS[nextIndex];
    
    if (videoRef.current) {
      videoRef.current.playbackRate = nextSpeed;
      setPlaybackSpeed(nextSpeed);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const progress = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setProgress(progress || 0);
    }
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      videoRef.current.currentTime = pos * videoRef.current.duration;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogOverlay className="bg-black/90" />
      <DialogContent 
        className="max-w-4xl w-full p-0 overflow-hidden bg-black"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="relative">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            aria-label="Close video"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Video */}
          <iframe
            src={VIDEO_URL}
            width="100%"
            height="400"
            allow="autoplay"
            allowFullScreen
            className="w-full h-auto max-h-[70vh] rounded-lg"
            title="Welcome Video"
            style={{ borderRadius: '8px', background: 'black' }}
          ></iframe>

          {/* Controls */}
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {/* Mute/Unmute */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleMute}
                  className="text-white hover:bg-white/20"
                >
                  {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                </Button>

                {/* Speed indicator */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={changeSpeed}
                  className="text-white hover:bg-white/20 text-xs font-medium min-w-[3rem]"
                >
                  {playbackSpeed}x
                </Button>
              </div>
              {/* "Welcome" label */}
              <div className="text-white text-sm font-medium">
                Welcome to Amerivet Benefits
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
