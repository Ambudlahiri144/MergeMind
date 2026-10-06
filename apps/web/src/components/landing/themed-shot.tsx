import Image, { getImageProps, type StaticImageData } from 'next/image';

import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/theme';

/**
 * A real screenshot in the page's theme. A pinned theme (cookie) gets that image; "system"
 * gets a <picture> that follows prefers-color-scheme, so only one image is downloaded.
 */
export function ThemedShot({
  theme,
  light,
  dark,
  alt,
  sizes,
  isPriority = false,
  className,
}: {
  theme: Theme;
  light: StaticImageData;
  dark: StaticImageData;
  alt: string;
  sizes: string;
  isPriority?: boolean;
  className?: string;
}) {
  const imageClass = cn('h-auto w-full', className);
  if (theme !== 'system') {
    return (
      <Image
        src={theme === 'dark' ? dark : light}
        alt={alt}
        sizes={sizes}
        priority={isPriority}
        className={imageClass}
      />
    );
  }
  const common = { alt, sizes, priority: isPriority };
  const { props: darkProps } = getImageProps({ ...common, src: dark });
  const { props: lightProps } = getImageProps({ ...common, src: light });
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={darkProps.srcSet} sizes={sizes} />
      {/* Art-directed <picture> with getImageProps, as the Next.js image docs show. */}
      <img {...lightProps} alt={alt} className={imageClass} />
    </picture>
  );
}
