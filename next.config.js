/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdfjs-dist tente d'importer 'canvas' côté serveur — on désactive
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    return config;
  },
};

module.exports = nextConfig;
