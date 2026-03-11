'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';
import { Play, Pause, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const VIDEO_URL = 'https://drive.google.com/file/d/1rb4X8k-_pqVO33v9H7SO4_Zf3XgYJ6jJ/preview';
const STORAGE_KEY = 'welcome_video_watched';

export function WelcomeVideoModal() {
  const [open, setOpen] = useState(false);
  const [hasWatched, setHasWatched] = useState(false);

  useEffect(() => {
    const watched = localStorage.getItem(STORAGE_KEY);
    if (!watched) {
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
      localStorage.setItem(STORAGE_KEY, 'true');
    }
    setOpen(newOpen);
  };

  const handleClose = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
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

          {/* Google Drive Video Embed */}
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

          <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
            <div className="flex items-center justify-end">
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
