import Image, { type ImageProps } from 'next/image';

import amerivetLogo from '@/public/brand/amerivet-logo.png';

type AmeriVetLogoProps = Omit<ImageProps, 'src' | 'alt'> & {
  alt?: string;
};

export function AmeriVetLogo({
  alt = 'AmeriVet',
  ...props
}: AmeriVetLogoProps) {
  return <Image src={amerivetLogo} alt={alt} {...props} />;
}
