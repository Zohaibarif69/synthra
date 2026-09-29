import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Ask search engines not to index the site
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default nextConfig;
