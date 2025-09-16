import type { ReactNode } from 'react';

export interface ShowComponentProps {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
}
