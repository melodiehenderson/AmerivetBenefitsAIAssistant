// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  
  // Move skipMiddlewareUrlNormalize to top level per Next.js 14
  skipMiddlewareUrlNormalize: true,
  
  // Note: removed invalid experimental.staticGenerationRetryCount (not supported in 14.x)
  eslint: {
    // SECURITY: Do NOT silence ESLint during builds. Errors should fail the build.
    // If TS files need to be linted, install @typescript-eslint and update eslint.config.mjs.
    ignoreDuringBuilds: false,
  },
  typescript: {
    // SECURITY: Do NOT suppress TypeScript errors. Type errors should fail the build.
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.blob.core.windows.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.azurewebsites.net',
      },
    ],
  },
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },
  compress: true,
  poweredByHeader: false,
  generateEtags: true,
  httpAgentOptions: {
    keepAlive: true,
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
