/** Lightweight class-name joiner (replaces clsx + tailwind-merge). */
export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}
