'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';
import { X } from 'lucide-react';

const VIDEO_URL = 'https://drive.google.com/file/d/1rb4X8k-_pqVO33v9H7SO4_Zf3XgYJ6jJ/preview';
const STORAGE_KEY = 'welcome_video_watched';

interface WelcomeVideoModalProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function WelcomeVideoModal({ forceOpen, onClose }: WelcomeVideoModalProps = {}) {
  const [open, setOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setIsClosing(false);
      return;
    }
    const watched = localStorage.getItem(STORAGE_KEY);
    if (!watched) {
      const timer = setTimeout(() => setOpen(true), 500);
      return () => clearTimeout(timer);
    }
  }, [forceOpen]);

  const handleClose = () => {
    // Start the fly-to-button animation, then close after it completes.
    setIsClosing(true);
    setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, 'true');
      setOpen(false);
      setIsClosing(false);
      onClose?.();
    }, 420);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogOverlay
        className="bg-black/90"
        style={{
          transition: 'opacity 0.42s ease',
          opacity: isClosing ? 0 : undefined,
        }}
      />
      <DialogContent
        className="max-w-3xl w-full p-0 overflow-hidden bg-black"
        onPointerDownOutside={(e) => e.preventDefault()}
        style={{
          /*
           * When closing, shrink toward top-right — the approximate location of
           * the "Watch intro" button in the dashboard header.
           * transformOrigin top-right makes it visually fly toward that corner.
           */
          transformOrigin: 'top right',
          transition: isClosing
            ? 'transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease'
            : 'none',
          transform: isClosing ? 'scale(0.04) translate(10%, -10%)' : undefined,
          opacity: isClosing ? 0 : undefined,
          pointerEvents: isClosing ? 'none' : undefined,
        }}
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

          {/* 16:9 aspect ratio wrapper */}
          <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={VIDEO_URL}
              allow="autoplay"
              allowFullScreen
              title="Welcome to AmeriVet Benefits"
              className="absolute inset-0 w-full h-full"
              style={{ background: 'black' }}
            />
          </div>

          <div className="px-4 py-3 bg-black/90 text-white text-sm font-medium text-center">
            Welcome to AmeriVet Benefits
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
