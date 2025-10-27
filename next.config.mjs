/** @type {import('next').NextConfig} */
import withPWA from 'next-pwa';

const isProd = process.env.NODE_ENV === 'production';

export default withPWA({
  dest: 'public',
  disable: !isProd
})({
  images: { unoptimized: true }
});
