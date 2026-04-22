'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogOverlay } from '@/components/ui/dialog';
import { X } from 'lucide-react';

const VIDEO_URL = 'https://drive.google.com/file/d/1rb4X8k-_pqVO33v9H7SO4_Zf3XgYJ6jJ/preview';

interface WelcomeVideoModalProps {
  onClose: () => void;
}

/**
 * Always mounts open. Parent controls visibility via conditional rendering.
 * Calling onClose triggers the fly-out animation, then unmounts via parent.
 */
export function WelcomeVideoModal({ onClose }: WelcomeVideoModalProps) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 420);
  };

  return (
    <Dialog open={!isClosing} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogOverlay
        className="bg-black/90"
        style={{
          transition: 'opacity 0.42s ease',
          opacity: isClosing ? 0 : undefined,
        }}
      />
      <DialogContent
        className="max-w-3xl w-full p-0 overflow-visible bg-black"
        onPointerDownOutside={(e) => e.preventDefault()}
        style={{
          transformOrigin: 'top right',
          transition: isClosing
            ? 'transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease'
            : 'none',
          transform: isClosing ? 'scale(0.04) translate(10%, -10%)' : undefined,
          opacity: isClosing ? 0 : undefined,
          pointerEvents: isClosing ? 'none' : undefined,
        }}
      >
        {/* Close button outside iframe stacking context */}
        <button
          onClick={handleClose}
          className="absolute -top-4 -right-4 z-50 p-2 rounded-full bg-black/80 hover:bg-black text-white transition-colors shadow-lg"
          aria-label="Close video"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="overflow-hidden rounded-md">
          {/* 16:9 aspect ratio */}
          <div className="relative w-full" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={VIDEO_URL}
              allow="autoplay"
              allowFullScreen
              title="Welcome to AmeriVet Benefits"
              className="absolute inset-0 w-full h-full"
              style={{ background: 'black', display: 'block' }}
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
