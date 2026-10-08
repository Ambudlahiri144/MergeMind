import { getImageProps, type StaticImageData } from 'next/image';

import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/theme';

/** Phones get the `narrow` images when given (a crop that stays readable at ~350px). */
const NARROW_MEDIA = '(max-width: 767px)';
const DARK_MEDIA = '(prefers-color-scheme: dark)';

type Pair = { light: StaticImageData; dark: StaticImageData };

/**
 * A real screenshot in the page's theme, as one art-directed <picture> (the Next.js image docs'
 * getImageProps pattern), so the browser downloads exactly one file:
 * - a pinned theme (cookie) uses that theme's images; "system" follows prefers-color-scheme;
 * - with `narrow`, screens under 768px get the narrow crop instead.
 */
export function ThemedShot({
  theme,
  light,
  dark,
  narrow,
  alt,
  sizes,
  narrowSizes = '100vw',
  isPriority = false,
  className,
}: Pair & {
  theme: Theme;
  narrow?: Pair;
  alt: string;
  sizes: string;
  narrowSizes?: string;
  isPriority?: boolean;
  className?: string;
}) {
  const props = (src: StaticImageData, imageSizes: string) =>
    getImageProps({ alt, src, sizes: imageSizes, priority: isPriority }).props;
  const sources: { media: string; image: ReturnType<typeof props> }[] = [];
  const add = (media: string, src: StaticImageData, imageSizes: string) => {
    sources.push({ media, image: props(src, imageSizes) });
  };

  if (narrow) {
    if (theme === 'system') {
      add(`${NARROW_MEDIA} and ${DARK_MEDIA}`, narrow.dark, narrowSizes);
      add(NARROW_MEDIA, narrow.light, narrowSizes);
    } else {
      add(NARROW_MEDIA, theme === 'dark' ? narrow.dark : narrow.light, narrowSizes);
    }
  }
  if (theme === 'system') {
    add(DARK_MEDIA, dark, sizes);
  }
  const fallback = props(theme === 'dark' ? dark : light, sizes);

  return (
    <picture>
      {sources.map(({ media, image }) => (
        <source
          key={media}
          media={media}
          srcSet={image.srcSet}
          sizes={image.sizes}
          width={image.width}
          height={image.height}
        />
      ))}
      {/* Art-directed <picture> with getImageProps, as the Next.js image docs show. */}
      <img {...fallback} alt={alt} className={cn('h-auto w-full', className)} />
    </picture>
  );
}
