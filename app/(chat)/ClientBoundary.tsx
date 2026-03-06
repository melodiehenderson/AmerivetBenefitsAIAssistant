"use client";
import type { ReactNode } from 'react';
export default function ClientBoundary({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
