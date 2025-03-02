/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Remove the standalone output for now
  // output: 'standalone',
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        stream: false,
        crypto: false,
      };
    }
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'tesseract.js']
  },
  images: {
    domains: ['firebasestorage.googleapis.com']
  }
}

module.exports = nextConfig // Force deploy Sun Mar  2 13:07:58 EST 2025
